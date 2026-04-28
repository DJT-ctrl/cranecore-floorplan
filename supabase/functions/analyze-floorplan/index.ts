import { generateAnnotatedImage, generateJsonWithFallback } from "./gemini.ts";
import { normalizeAnalysis } from "./geometry.ts";
import {
  classificationPrompt,
  geometryPrompt,
  imageOverlayPrompt,
  openingsPrompt,
} from "./prompts.ts";
import {
  classificationSchema,
  geometrySchema,
  openingsSchema,
} from "./schemas.ts";
import type {
  AnalysisMode,
  AnalyzeFloorPlanRequest,
  AnalyzeFloorPlanResponse,
  GeminiClassificationResult,
  GeminiGeometryResult,
  GeminiOpeningsResult,
} from "./types.ts";

const STREAM_HEARTBEAT_MS = 8_000;
const ANALYSIS_TIMEOUT_MS = 35_000;

export async function handleRequest(request: Request): Promise<Response> {
  const corsHeaders = buildCorsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json(
      { error: "Missing GEMINI_API_KEY in Supabase function environment." },
      500,
      corsHeaders,
    );
  }

  const auth = authorizeRequest(request);
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status, corsHeaders);
  }

  let normalizedRequest: AnalyzeFloorPlanRequest;
  try {
    const body = await request.json() as AnalyzeFloorPlanRequest;
    normalizedRequest = normalizeRequest(body);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Invalid request body.";
    return json({ error: message }, 400, corsHeaders);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let writeQueue = Promise.resolve();

  const writeChunk = (chunk: string): Promise<void> => {
    const nextWrite = writeQueue.then(() =>
      writer.write(encoder.encode(chunk))
    );
    writeQueue = nextWrite.catch(() => {});
    return nextWrite;
  };

  const emit = (data: object): Promise<void> =>
    writeChunk(`data: ${JSON.stringify(data)}\n\n`);

  const heartbeatId = setInterval(() => {
    void writeChunk(": keep-alive\n\n").catch(() => {});
  }, STREAM_HEARTBEAT_MS);

  let analysisFinished = false;

  const safetyTimerId = setTimeout(async () => {
    if (analysisFinished) return;
    console.error("[analyze-floorplan] safety timeout fired after", ANALYSIS_TIMEOUT_MS, "ms");
    await emit({
      type: "error",
      error:
        "Analysis timed out after 35 seconds. Please retry — or switch to Normal mode / use a smaller image if this keeps happening.",
    }).catch(() => {});
    clearInterval(heartbeatId);
    await writer.close().catch(() => {});
  }, ANALYSIS_TIMEOUT_MS);

  (async () => {
    try {
      console.log("[analyze-floorplan] starting analysis, mode:", normalizedRequest.mode);
      await runAnalysis(apiKey, normalizedRequest, emit);
      console.log("[analyze-floorplan] analysis complete");
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown floor plan analysis error.";
      console.error("[analyze-floorplan] runAnalysis error:", message, error instanceof Error ? error.stack : "");
      await emit({ type: "error", error: message }).catch(() => {});
    } finally {
      analysisFinished = true;
      clearTimeout(safetyTimerId);
      clearInterval(heartbeatId);
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      ...(corsHeaders as Record<string, string>),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

type AuthResult =
  | { ok: true; identity: string; via: "apiKey" | "ip" }
  | { ok: false; status: number; error: string };

function authorizeRequest(request: Request): AuthResult {
  const configured = (Deno.env.get("API_KEYS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (configured.length === 0) {
    const ip = clientIp(request);
    return { ok: true, identity: `ip:${ip}`, via: "ip" };
  }

  const provided = request.headers.get("x-api-key")?.trim() ?? "";
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: "Missing x-api-key header.",
    };
  }
  if (!configured.includes(provided)) {
    return { ok: false, status: 403, error: "Invalid API key." };
  }
  return { ok: true, identity: `key:${provided}`, via: "apiKey" };
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

async function runAnalysis(
  apiKey: string,
  request: AnalyzeFloorPlanRequest,
  emit: (data: object) => Promise<void>,
): Promise<void> {
  const mode = normalizeMode(request.mode);
  const requestedAnalysisModel = mode === "enhanced"
    ? Deno.env.get("GEMINI_MODEL_ENHANCED") ?? "gemini-3.1-pro-preview"
    : Deno.env.get("GEMINI_MODEL_NORMAL") ?? "gemini-2.5-flash";
  const fallbackModel = Deno.env.get("GEMINI_MODEL_FALLBACK") ??
    "gemini-2.5-pro";
  const imageModel = mode === "enhanced"
    ? Deno.env.get("GEMINI_IMAGE_MODEL_ENHANCED") ??
      "gemini-3.1-flash-image-preview"
    : Deno.env.get("GEMINI_IMAGE_MODEL_NORMAL") ?? "gemini-2.5-flash-image";
  const image = {
    base64: stripDataUrl(request.imageBase64),
    mimeType: request.mimeType ?? "image/jpeg",
  };

  await emit({
    type: "step_start",
    step: "geometry",
    label: "Extracting room geometry",
    progress: 5,
  });
  const geometryResult = await generateJsonWithFallback<GeminiGeometryResult>({
    apiKey,
    model: requestedAnalysisModel,
    fallbackModel,
    prompt: geometryPrompt(request),
    image,
    responseSchema: geometrySchema,
  });
  await emit({ type: "step_done", step: "geometry", progress: 28 });

  await emit({
    type: "step_start",
    step: "classification",
    label: "Classifying room types",
    progress: 30,
  });
  const classificationResult = await generateJsonWithFallback<
    GeminiClassificationResult
  >({
    apiKey,
    model: geometryResult.model,
    fallbackModel,
    prompt: classificationPrompt(geometryResult.data),
    image,
    responseSchema: classificationSchema,
  });
  await emit({ type: "step_done", step: "classification", progress: 52 });

  await emit({
    type: "step_start",
    step: "openings",
    label: "Detecting doors & windows",
    progress: 55,
  });
  const openingsResult = await generateJsonWithFallback<GeminiOpeningsResult>({
    apiKey,
    model: classificationResult.model,
    fallbackModel,
    prompt: openingsPrompt(geometryResult.data, classificationResult.data),
    image,
    responseSchema: openingsSchema,
  });
  await emit({ type: "step_done", step: "openings", progress: 72 });

  const normalized = normalizeAnalysis(
    request,
    geometryResult.data,
    classificationResult.data,
    openingsResult.data,
  );
  const warnings = [...normalized.warnings];
  const summaryText = `Total ${
    normalized.summary.totalAreaM2.toFixed(2)
  } m² | Floor ${normalized.summary.floorAreaM2.toFixed(2)} m² | Walls ${
    normalized.summary.wallAreaM2.toFixed(2)
  } m² | Glass ${
    normalized.summary.glassAreaM2.toFixed(2)
  } m² | Rooms ${normalized.summary.roomCount} | Doors ${normalized.summary.doorCount} | Windows ${normalized.summary.windowCount}`;

  const overlayWalls = normalized.walls.map((wall) => ({
    polyline: wall.polyline,
    thicknessPx: Math.max(
      1,
      Math.round(wall.thicknessM * normalized.scale.pxPerM),
    ),
  }));
  const overlayGlazing = normalized.glazing.map((segment) => ({
    polyline: segment.polyline,
    thicknessPx: Math.max(
      1,
      Math.round(segment.thicknessM * normalized.scale.pxPerM),
    ),
  }));

  await emit({
    type: "step_start",
    step: "annotation",
    label: "Generating annotated image",
    progress: 78,
  });
  let annotatedImage: AnalyzeFloorPlanResponse["annotatedImage"];
  try {
    const generatedImage = await generateAnnotatedImage({
      apiKey,
      model: imageModel,
      prompt: imageOverlayPrompt(
        normalized.rooms,
        summaryText,
        normalized.outerOutline,
        overlayWalls,
        overlayGlazing,
      ),
      image,
    });
    annotatedImage = { ...generatedImage, model: imageModel };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown image annotation error.";
    warnings.push(`AI image overlay unavailable: ${message}`);
  }
  await emit({ type: "step_done", step: "annotation", progress: 96 });

  const result: AnalyzeFloorPlanResponse = {
    image: {
      widthPx: normalized.imageWidthPx,
      heightPx: normalized.imageHeightPx,
      mimeType: image.mimeType,
    },
    annotatedImage,
    model: {
      mode,
      requestedAnalysisModel,
      actualAnalysisModel: openingsResult.model,
      imageModel,
    },
    scale: normalized.scale,
    rooms: normalized.rooms,
    doors: normalized.doors,
    windows: normalized.windows,
    walls: normalized.walls,
    glazing: normalized.glazing,
    outerOutline: normalized.outerOutline,
    summary: normalized.summary,
    warnings,
  };

  await emit({ type: "complete", result, progress: 100 });
}

function normalizeRequest(
  request: AnalyzeFloorPlanRequest,
): AnalyzeFloorPlanRequest {
  if (!request.imageBase64 || typeof request.imageBase64 !== "string") {
    throw new Error("imageBase64 is required.");
  }

  const base64 = stripDataUrl(request.imageBase64);
  const maxBase64Length = 14 * 1024 * 1024;
  if (base64.length > maxBase64Length) {
    throw new Error(
      "Image is too large. Use a smaller image or downscale before sending.",
    );
  }

  return {
    ...request,
    imageBase64: base64,
    mimeType: request.mimeType ?? parseMimeType(request.imageBase64) ??
      "image/png",
    imageWidthPx: positiveNumber(request.imageWidthPx),
    imageHeightPx: positiveNumber(request.imageHeightPx),
  };
}

function normalizeMode(mode: AnalysisMode | undefined): AnalysisMode {
  return mode === "enhanced" ? "enhanced" : "normal";
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function stripDataUrl(value: string): string {
  const commaIndex = value.indexOf(",");
  if (value.startsWith("data:") && commaIndex >= 0) {
    return value.slice(commaIndex + 1);
  }
  return value;
}

function parseMimeType(value: string): string | undefined {
  const match = value.match(/^data:([^;]+);base64,/);
  return match?.[1];
}

function buildCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const configuredOrigin = Deno.env.get("CORS_ORIGIN") ?? "*";
  const allowOrigin =
    origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
      ? origin
      : configuredOrigin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, x-api-key, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}
