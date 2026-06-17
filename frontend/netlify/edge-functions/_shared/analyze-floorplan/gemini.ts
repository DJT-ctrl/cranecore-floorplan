import type { GeminiImageInput } from "./types.ts";

const apiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

interface JsonRequest<T> {
  apiKey: string;
  model: string;
  fallbackModel: string;
  prompt: string;
  image: GeminiImageInput;
  responseSchema: unknown;
  timeoutMs?: number;
}

interface ImageRequest {
  apiKey: string;
  model: string;
  prompt: string;
  image: GeminiImageInput;
  timeoutMs?: number;
}

export async function generateJsonWithFallback<T>(
  request: JsonRequest<T>,
): Promise<{ data: T; model: string }> {
  const models = request.model === request.fallbackModel
    ? [request.model]
    : [request.model, request.fallbackModel];
  let lastError: unknown;

  for (const model of models) {
    for (
      const prompt of [
        request.prompt,
        `${request.prompt}\n\nRetry instruction: return only valid JSON matching the schema. No markdown.`,
      ]
    ) {
      try {
        const data = await generateJson<T>({ ...request, model, prompt });
        return { data, model };
      } catch (error) {
        lastError = error;
        if (error instanceof GeminiHttpError && isModelUnavailable(error)) {
          break;
        }
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini JSON generation failed.");
}

export async function generateAnnotatedImage(
  request: ImageRequest,
): Promise<{ base64: string; mimeType: string; notes?: string }> {
  const response = await postGenerateContent({
    apiKey: request.apiKey,
    model: request.model,
    timeoutMs: request.timeoutMs ?? 120_000,
    body: {
      contents: [{
        role: "user",
        parts: [
          { text: request.prompt },
          {
            inlineData: {
              mimeType: request.image.mimeType,
              data: request.image.base64,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        responseModalities: ["TEXT", "IMAGE"],
      },
    },
  });

  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part: Record<string, unknown>) =>
    part.inlineData || part.inline_data
  );
  const inlineData = (imagePart?.inlineData ?? imagePart?.inline_data) as {
    data?: string;
    mimeType?: string;
    mime_type?: string;
  } | undefined;

  if (!inlineData?.data) {
    throw new Error("Gemini image model did not return an annotated image.");
  }

  return {
    base64: inlineData.data,
    mimeType: inlineData.mimeType ?? inlineData.mime_type ?? "image/png",
    notes: collectText(response),
  };
}

async function generateJson<T>(request: JsonRequest<T>): Promise<T> {
  const response = await postGenerateContent({
    apiKey: request.apiKey,
    model: request.model,
    timeoutMs: request.timeoutMs ?? 90_000,
    body: {
      contents: [{
        role: "user",
        parts: [
          { text: request.prompt },
          {
            inlineData: {
              mimeType: request.image.mimeType,
              data: request.image.base64,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: request.responseSchema,
      },
    },
  });

  const text = collectText(response);
  return JSON.parse(extractJson(text)) as T;
}

async function postGenerateContent(
  options: { apiKey: string; model: string; body: unknown; timeoutMs: number },
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(
      `${apiBaseUrl}/models/${options.model}:generateContent?key=${options.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new GeminiHttpError(
        response.status,
        details || response.statusText,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function collectText(response: unknown): string {
  const candidates = (response as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }).candidates ?? [];
  return candidates
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return trimmed.slice(firstObject, lastObject + 1);
  }

  throw new Error("Gemini did not return parseable JSON.");
}

function isModelUnavailable(error: GeminiHttpError): boolean {
  const message = error.message.toLowerCase();
  return error.status === 404 ||
    (error.status === 400 &&
      (message.includes("model") || message.includes("not found") ||
        message.includes("not supported")));
}
