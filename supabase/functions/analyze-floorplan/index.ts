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

const port = Number(Deno.env.get("FUNCTIONS_PORT") ?? "54321");

const RATE_LIMIT_MAX = Number(Deno.env.get("RATE_LIMIT_MAX") ?? "10");
const RATE_LIMIT_WINDOW_MS =
  Number(Deno.env.get("RATE_LIMIT_WINDOW_MINUTES") ?? "60") * 60 * 1000;

const kvPromise: Promise<Deno.Kv | null> = (async () => {
  try {
    return await Deno.openKv();
  } catch (_error) {
    return null;
  }
})();
const memoryRateStore = new Map<string, number[]>();

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

  const rate = await checkRateLimit(auth.identity);
  const rateHeaders: Record<string, string> = {
    "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
    "X-RateLimit-Remaining": String(Math.max(0, rate.remaining)),
  };
  if (!rate.allowed) {
    return json(
      {
        error:
          `Rate limit exceeded. Max ${RATE_LIMIT_MAX} requests per ${
            RATE_LIMIT_WINDOW_MS / 60000
          } minutes.`,
      },
      429,
      {
        ...corsHeaders,
        ...rateHeaders,
        "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)),
      },
    );
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

  const emit = (data: object): Promise<void> =>
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  (async () => {
    try {
      await runAnalysis(apiKey, normalizedRequest, emit);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown floor plan analysis error.";
      await emit({ type: "error", error: message }).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      ...(corsHeaders as Record<string, string>),
      ...rateHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

if (import.meta.main) {
  Deno.serve({ port }, handleRequest);
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

interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

async function checkRateLimit(identity: string): Promise<RateLimitDecision> {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const kv = await kvPromise;

  if (kv) {
    const key = ["ratelimit", identity];
    const entry = await kv.get<number[]>(key);
    const previous = entry.value ?? [];
    const recent = previous.filter((ts) => ts > windowStart);
    if (recent.length >= RATE_LIMIT_MAX) {
      const oldest = recent[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1000, oldest + RATE_LIMIT_WINDOW_MS - now),
      };
    }
    recent.push(now);
    await kv.set(key, recent, {
      expireIn: RATE_LIMIT_WINDOW_MS + 60_000,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX - recent.length,
      retryAfterMs: 0,
    };
  }

  const previous = memoryRateStore.get(identity) ?? [];
  const recent = previous.filter((ts) => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX) {
    const oldest = recent[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1000, oldest + RATE_LIMIT_WINDOW_MS - now),
    };
  }
  recent.push(now);
  memoryRateStore.set(identity, recent);
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - recent.length,
    retryAfterMs: 0,
  };
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
  const configuredOrigin = Deno.env.get("CORS_ORIGIN") ??
    "http://localhost:5173";
  const allowOrigin =
    origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
      ? origin
      : configuredOrigin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, x-api-key, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers":
      "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After",
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
