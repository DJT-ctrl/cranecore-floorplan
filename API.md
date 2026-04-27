# CraneCore — analyze-floorplan API

## Endpoint

```
POST https://nilqrjxqfwjyihcukbux.supabase.co/functions/v1/analyze-floorplan
```

---

## Authentication

Pass your API key in the `x-api-key` header on every request.

| Header | Value |
|---|---|
| `x-api-key` | `cc-local-dev-k7m2p9` |

> **Keep this key secret.** Do not commit it to source control or expose it in client-side code.

---

## Request

**Content-Type:** `application/json`

### Body fields

| Field | Type | Required | Description |
|---|---|---|---|
| `imageBase64` | `string` | **Yes** | Base64-encoded floor plan image. May include a `data:image/…;base64,` prefix — it will be stripped automatically. |
| `mimeType` | `string` | No | MIME type of the image (default: `image/jpeg`). Use `image/png` or `image/webp` as needed. |
| `imageWidthPx` | `number` | No | Pixel width of the image. Helps scale calculations. |
| `imageHeightPx` | `number` | No | Pixel height of the image. Helps scale calculations. |
| `mode` | `"normal"` \| `"enhanced"` | No | Analysis quality mode (default: `"normal"`). `"enhanced"` uses higher-tier Gemini models. |
| `pxPerM` | `number` | No | Override pixels-per-metre scale factor. |
| `knownTotalAreaM2` | `number` | No | Known total floor area in m² — used to back-calculate scale when no dimension labels are found. |
| `notes` | `string` | No | Free-text hints passed to the AI (e.g. `"Scale bar = 5 m"`). |

### Example request

```json
{
  "imageBase64": "<base64-encoded image>",
  "mimeType": "image/png",
  "mode": "normal"
}
```

---

## Response

The response is a **Server-Sent Events (SSE)** stream (`Content-Type: text/event-stream`). Each line is prefixed with `data: ` and contains a JSON object.

### Stream event types

#### `step_start`
Emitted when a processing step begins.

```json
{ "type": "step_start", "step": "geometry",       "label": "Extracting room geometry",    "progress": 5  }
{ "type": "step_start", "step": "classification",  "label": "Classifying room types",      "progress": 30 }
{ "type": "step_start", "step": "openings",        "label": "Detecting doors & windows",   "progress": 55 }
{ "type": "step_start", "step": "annotation",      "label": "Generating annotated image",  "progress": 78 }
```

#### `step_done`
Emitted when a step completes.

```json
{ "type": "step_done", "step": "geometry",      "progress": 28 }
{ "type": "step_done", "step": "classification","progress": 52 }
{ "type": "step_done", "step": "openings",      "progress": 72 }
{ "type": "step_done", "step": "annotation",    "progress": 96 }
```

#### `complete`
Final event. Contains the full analysis result.

```json
{ "type": "complete", "progress": 100, "result": { ... } }
```

#### `error`
Emitted if analysis fails.

```json
{ "type": "error", "error": "Human-readable error message" }
```

---

## Complete result object (`complete.result`)

```ts
{
  image: {
    widthPx:  number,
    heightPx: number,
    mimeType: string
  },

  annotatedImage?: {         // may be absent if AI overlay failed
    base64:   string,        // base64-encoded annotated PNG
    mimeType: string,
    model:    string,
    notes?:   string
  },

  model: {
    mode:                    "normal" | "enhanced",
    requestedAnalysisModel:  string,
    actualAnalysisModel:     string,
    imageModel:              string
  },

  scale: {
    pxPerM:      number,
    source:      "dimensionLabel" | "fallback" | "userOverride" | "knownTotalArea" | "unknown",
    confidence:  number,
    explanation: string
  },

  rooms: [
    {
      id:         string,
      sourceId:   string,
      name:       string,
      type:       "bedroom" | "bathroom" | "kitchen" | "hall" | "livingRoom"
                | "diningRoom" | "corridor" | "closet" | "utility" | "office" | "other",
      color:      string,      // hex color for rendering
      label:      string,
      polygon:    [{ x: number, y: number }],
      centroid:   { x: number, y: number },
      areaM2:     number,
      areaCm2:    number,
      confidence: number       // 0–1
    }
  ],

  doors: [
    {
      id:         string,
      position:   { x: number, y: number },
      roomIds:    string[],
      confidence: number
    }
  ],

  windows: [
    {
      id:         string,
      position:   { x: number, y: number },
      roomIds:    string[],
      confidence: number
    }
  ],

  walls: [
    {
      id:          string,
      polyline:    [{ x: number, y: number }],
      thicknessM:  number,
      lengthM:     number,
      areaM2:      number,
      confidence:  number
    }
  ],

  glazing: [
    {
      id:          string,
      polyline:    [{ x: number, y: number }],
      thicknessM:  number,
      lengthM:     number,
      areaM2:      number,
      roomId?:     string,
      confidence:  number
    }
  ],

  outerOutline: [{ x: number, y: number }],

  summary: {
    totalAreaM2:          number,
    roomAreaM2:           number,
    wallAreaM2:           number,
    glassAreaM2:          number,
    netAreaM2:            number,
    floorAreaM2:          number,
    totalFootprintAreaM2: number,
    roomCount:            number,
    doorCount:            number,
    windowCount:          number,
    typeCounts:           Record<string, number>   // e.g. { "bedroom": 3, "bathroom": 2 }
  },

  warnings: string[]
}
```

---

## Rate limiting

| Header returned | Meaning |
|---|---|
| `X-RateLimit-Limit` | Max requests allowed per window (default: 10) |
| `X-RateLimit-Remaining` | Requests left in current window |
| `Retry-After` | Seconds to wait when a 429 is returned |

Default window: **10 requests per 60 minutes** per API key.  
HTTP `429` is returned when the limit is exceeded.

---

## HTTP error codes

| Code | Meaning |
|---|---|
| `400` | Bad request — missing or invalid `imageBase64` |
| `401` | Missing `x-api-key` header |
| `403` | Invalid API key |
| `405` | Method not allowed (only `POST` is accepted) |
| `429` | Rate limit exceeded |
| `500` | Server-side configuration error |

---

## Code examples

### JavaScript / TypeScript (fetch + SSE)

```ts
async function analyzeFloorPlan(imageBase64: string) {
  const response = await fetch(
    "https://nilqrjxqfwjyihcukbux.supabase.co/functions/v1/analyze-floorplan",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "cc-local-dev-k7m2p9",
      },
      body: JSON.stringify({ imageBase64, mimeType: "image/png", mode: "normal" }),
    }
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));

      if (event.type === "step_start") {
        console.log(`[${event.progress}%] ${event.label}`);
      } else if (event.type === "complete") {
        console.log("Done!", event.result.summary);
      } else if (event.type === "error") {
        console.error("Analysis error:", event.error);
      }
    }
  }
}
```

### Python (requests + manual SSE parsing)

```python
import requests
import json

def analyze_floor_plan(image_base64: str):
    url = "https://nilqrjxqfwjyihcukbux.supabase.co/functions/v1/analyze-floorplan"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": "cc-local-dev-k7m2p9",
    }
    payload = {"imageBase64": image_base64, "mimeType": "image/png", "mode": "normal"}

    with requests.post(url, headers=headers, json=payload, stream=True) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line:
                continue
            text = line.decode("utf-8")
            if not text.startswith("data: "):
                continue
            event = json.loads(text[6:])

            if event["type"] == "step_start":
                print(f"[{event['progress']}%] {event['label']}")
            elif event["type"] == "complete":
                print("Done!", event["result"]["summary"])
            elif event["type"] == "error":
                print("Error:", event["error"])
```

### cURL (quick test)

```bash
curl -N -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: cc-local-dev-k7m2p9" \
  -d '{"imageBase64":"<base64>","mode":"normal"}' \
  https://nilqrjxqfwjyihcukbux.supabase.co/functions/v1/analyze-floorplan
```
