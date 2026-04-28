import type {
  AnalyzeFloorPlanRequest,
  GeminiClassificationResult,
  GeminiGeometryResult,
  NormalizedRoom,
  Point,
} from "./types.ts";

export const userFloorPlanPrompt =
  "Analyze the provided floor plan image and calculate the total area of the blueprint with appropriate units based on the assumed scale, then segment the entire layout into distinct closed regions by identifying individual rooms or spaces and representing each as a polygon, generating an annotated image where each polygon is highlighted in a different color with clearly defined boundaries; additionally, detect and count all doors and windows present in the plan, classify the identified spaces into room types such as bedrooms, kitchen, and halls based on layout patterns, and finally provide a concise summary including the total area, number of segmented polygons (rooms), counts of doors and windows, and the number of each room type.";

function requestContext(request: AnalyzeFloorPlanRequest): string {
  const details = [
    `Input image width px: ${request.imageWidthPx ?? "unknown"}`,
    `Input image height px: ${request.imageHeightPx ?? "unknown"}`,
    `All plan measurements and dimension labels must be interpreted as meters.`,
  ];

  return details.join("\n");
}

export function geometryPrompt(request: AnalyzeFloorPlanRequest): string {
  return `${userFloorPlanPrompt}

Agent step 1: extract geometry, scale, and per-room areas from the grayscale floor plan.

${requestContext(request)}

Return JSON only. Use pixel coordinates relative to the supplied image. Segment every closed room or space into a polygon with at least 3 points. Include only actual rooms/spaces visible in the plan.

Scale inference (REQUIRED, no user input is provided):
- Read the printed dimension labels on the plan (numbers along walls, total widths, total heights). Treat all dimension numbers as meters unless the plan clearly states otherwise.
- Pick at least one long, unambiguous dimension label, measure its pixel length on the image, and compute pxPerM = pixelLength / meterValue.
- Cross-check with a second dimension when possible. Set inferredScale.source to "dimensionLabel" and provide a short explanation of which label(s) you used.
- Only fall back to source "fallback" with a conservative pxPerM estimate if no dimension labels are readable, and explain why.

Area computation (REQUIRED):
- For every room, compute areaM2 = polygonAreaInPx / (pxPerM^2), rounded to 2 decimals.
- Compute totalAreaM2 as the sum of all room areaM2 values, rounded to 2 decimals.
- Return both areaM2 per room and a top-level totalAreaM2.

Walls and glazing (REQUIRED, returned in the SAME response):
- outerOutline: trace the OUTERMOST exterior wall face of the entire building as a single closed polygon (>=3 points) in pixel coordinates. This is the building footprint shape (exterior face of the perimeter walls).
- walls: list every wall segment in the plan as a centerline polyline (>=2 points along the middle of the wall) with a thicknessM value in meters (typical exterior 0.2-0.3 m, interior 0.1-0.15 m; measure from the plan if possible). Include both perimeter walls and interior partitions. Do NOT include door swings or furniture.
- glazing: list every window/glass segment as a polyline (2 points along the wall centerline marking where the glass spans) with a thicknessM value in meters (default to the host wall thickness if unsure). If the segment sits in a known room, set roomId to the geometry room id.
- All wall, glazing, and outline coordinates must be in the SAME pixel coordinate space as the room polygons.
- Use the same pxPerM scale already inferred above; do NOT re-derive a different scale for walls.`;
}

export function classificationPrompt(geometry: GeminiGeometryResult): string {
  return `Agent step 2: classify the extracted floor plan rooms.

Geometry JSON:
${JSON.stringify(geometry)}

Return JSON only. Use the exact room ids from the geometry JSON. Give each room a short human-readable name and classify it as one of the allowed room types. Use layout evidence such as fixtures, counters, doors, circulation, and adjacency.`;
}

export function openingsPrompt(
  geometry: GeminiGeometryResult,
  classification?: GeminiClassificationResult,
): string {
  const classificationSection = classification
    ? `\n\nClassification JSON:\n${JSON.stringify(classification)}`
    : "";
  return `Agent step 3: detect all doors and windows in the same grayscale floor plan.

Geometry JSON:
${JSON.stringify(geometry)}${classificationSection}

Return JSON only. Use pixel coordinates. Doors should be placed near swing arcs, breaks in walls, or doorway symbols. Windows should be placed along exterior wall openings. Reference room ids from the geometry JSON where possible.`;
}

export interface OverlayWall {
  polyline: Point[];
  thicknessPx: number;
}

export interface OverlayGlazing {
  polyline: Point[];
  thicknessPx: number;
}

export function imageOverlayPrompt(
  rooms: NormalizedRoom[],
  summaryText: string,
  outerOutline: Point[] | undefined,
  walls: OverlayWall[],
  glazing: OverlayGlazing[],
): string {
  const labels = rooms.map((room) => ({
    id: room.id,
    exactLabel: room.label,
    roomName: room.name,
    areaM2: room.areaM2,
    polygonPixelCoordinates: room.polygon,
    color: room.color,
  }));

  return `Create an annotated floor plan image from the supplied grayscale floor plan.

Use image editing only: draw the room polygons directly onto the image. Do not return a diagram separate from the plan. Highlight every polygon with the exact color in the label manifest, keep the original walls readable, draw clearly defined boundaries, and place the exact label text inside each matching room. The label text must be exactly the value of exactLabel for that room, which already contains the room name AND its size in square meters — render it as visible text inside the polygon, centered on the centroid, in a readable size. Do not add extra text labels beyond the manifest and summary.

Additionally:
- Trace the building outer outline polygon below with a thick solid stroke (#111111, ~6 px) so the exterior wall face is unmistakable.
- For each wall segment in the wall manifest, draw the centerline polyline stroked at its thicknessPx using a dark slate fill (#374151) at 70% opacity so wall mass reads clearly without hiding room labels.
- For each glazing segment in the glazing manifest, draw the polyline stroked at its thicknessPx in cyan (#06b6d4) so glass is highlighted on top of the wall.
- Do not add any new text or numeric labels for walls or glazing.

Label manifest:
${JSON.stringify(labels)}

Outer outline polygon (pixel coordinates):
${JSON.stringify(outerOutline ?? [])}

Wall manifest (centerline polylines + thicknessPx):
${JSON.stringify(walls)}

Glazing manifest (polylines + thicknessPx):
${JSON.stringify(glazing)}

Summary label for a small corner caption:
${summaryText}

Return the edited annotated image.`;
}
