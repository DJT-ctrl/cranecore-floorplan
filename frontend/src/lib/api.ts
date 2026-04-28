import type {
  AnalysisMode,
  FloorPlanAnalysis,
  PreparedImage,
  ProgressEvent,
} from "../types";

const analyzeUrl =
  import.meta.env.VITE_ANALYZE_FUNCTION_URL ??
  "/functions/v1/analyze-floorplan";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface AnalyzeOptions {
  image: PreparedImage;
  mode: AnalysisMode;
}

export async function analyzeFloorPlanStream(
  options: AnalyzeOptions,
  onProgress: (event: ProgressEvent) => void,
): Promise<FloorPlanAnalysis> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (anonKey) {
    headers.apikey = anonKey;
    headers.Authorization = `Bearer ${anonKey}`;
  }

  let response: Response;
  try {
    response = await fetch(analyzeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        imageBase64: options.image.base64,
        mimeType: options.image.mimeType,
        imageWidthPx: options.image.widthPx,
        imageHeightPx: options.image.heightPx,
        mode: options.mode,
      }),
    });
  } catch {
    throw new Error(
      `Cannot reach the analysis server at ${analyzeUrl}. ` +
        (analyzeUrl.startsWith("http://localhost")
          ? `Start it with: deno run --allow-net --allow-env --env-file=./supabase/.env ` +
            `supabase/functions/analyze-floorplan/index.ts`
          : `Please try again or contact support.`),
    );
  }

  if (!response.ok || !response.body) {
    const bodyText = await response.text().catch(() => "");
    const contentType = response.headers.get("content-type") ?? "";
    let errorMessage: string;
    try {
      const payload = JSON.parse(bodyText) as { error?: string };
      errorMessage = payload.error ?? `Server returned ${response.status}`;
    } catch {
      if (response.status === 404 && contentType.includes("text/html")) {
        errorMessage =
          `Request to ${analyzeUrl} returned Netlify's 404 page. ` +
          `That usually means this deploy URL does not have the edge function route active yet, ` +
          `or VITE_ANALYZE_FUNCTION_URL points at the wrong site/domain.`;
      } else {
        errorMessage =
          `Request to ${analyzeUrl} returned ${response.status}: ${bodyText.slice(0, 300)}`;
      }
    }
    throw new Error(errorMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    let done: boolean;
    let value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message === "Load failed"
          ? `Connection to ${analyzeUrl} dropped while analysis was still running. Please retry. If this keeps happening, switch to Normal mode or use a smaller image.`
          : `Connection to ${analyzeUrl} dropped while reading analysis updates. ${message}`,
      );
    }

    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;

      let event: ProgressEvent;
      try {
        const parsed = JSON.parse(raw) as { type: string };
        if (parsed.type === "heartbeat") continue;
        event = parsed as unknown as ProgressEvent;
      } catch {
        continue;
      }

      console.log("[analyze-floorplan]", event.type, event);
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "complete") return event.result;
      onProgress(event);
    }
  }

  throw new Error(
    "Analysis stream closed before a result was received. " +
    "Open the browser console (F12 → Console) to see the last events that arrived, " +
    "then retry. If this keeps happening, switch to Normal mode or use a smaller image."
  );
}
