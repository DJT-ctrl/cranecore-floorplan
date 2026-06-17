import type {
  AnalysisSummary,
  AnalyzeFloorPlanRequest,
  GeminiClassificationResult,
  GeminiGeometryResult,
  GeminiGlazingSegment,
  GeminiOpening,
  GeminiOpeningsResult,
  GeminiScale,
  GeminiWallSegment,
  NormalizedGlazing,
  NormalizedOpening,
  NormalizedRoom,
  NormalizedWall,
  Point,
  RoomType,
} from "./types.ts";

const roomTypes: RoomType[] = [
  "bedroom",
  "bathroom",
  "kitchen",
  "hall",
  "livingRoom",
  "diningRoom",
  "corridor",
  "closet",
  "utility",
  "office",
  "other",
];

export function polygonAreaPx(points: Point[]): number {
  if (points.length < 3) return 0;

  const sum = points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);

  return Math.abs(sum / 2);
}

export function polylineLengthPx(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };

  const signedArea = points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0) / 2;

  if (Math.abs(signedArea) < 0.0001) {
    const average = points.reduce(
      (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
      { x: 0, y: 0 },
    );
    return { x: average.x / points.length, y: average.y / points.length };
  }

  const centroid = points.reduce(
    (total, point, index) => {
      const next = points[(index + 1) % points.length];
      const cross = point.x * next.y - next.x * point.y;
      return {
        x: total.x + (point.x + next.x) * cross,
        y: total.y + (point.y + next.y) * cross,
      };
    },
    { x: 0, y: 0 },
  );

  return {
    x: centroid.x / (6 * signedArea),
    y: centroid.y / (6 * signedArea),
  };
}

export function normalizeAnalysis(
  request: AnalyzeFloorPlanRequest,
  geometry: GeminiGeometryResult,
  classification: GeminiClassificationResult,
  openings: GeminiOpeningsResult,
) {
  const imageWidthPx = Math.round(
    request.imageWidthPx ?? geometry.imageWidthPx ?? 0,
  );
  const imageHeightPx = Math.round(
    request.imageHeightPx ?? geometry.imageHeightPx ?? 0,
  );
  const warnings: string[] = [];

  const sourceRooms = (geometry.rooms ?? [])
    .map((room) => ({
      ...room,
      polygon: sanitizePolygon(room.polygon ?? [], imageWidthPx, imageHeightPx),
    }))
    .filter((room) => {
      const isValid = room.id && room.polygon.length >= 3 &&
        polygonAreaPx(room.polygon) > 1;
      if (!isValid) {
        warnings.push(
          `Skipped invalid room geometry from model: ${room.id || "unnamed"}`,
        );
      }
      return isValid;
    });

  const totalPixelArea = sourceRooms.reduce(
    (total, room) => total + polygonAreaPx(room.polygon),
    0,
  );
  const scale = resolveScale(request, geometry.inferredScale, totalPixelArea);
  const classificationById = new Map(
    (classification.rooms ?? []).map((room) => [room.id, room]),
  );

  const sortedRooms = [...sourceRooms].sort((left, right) => {
    const leftCentroid = polygonCentroid(left.polygon);
    const rightCentroid = polygonCentroid(right.polygon);
    return leftCentroid.y - rightCentroid.y || leftCentroid.x - rightCentroid.x;
  });

  const idMap = new Map<string, string>();
  const rooms: NormalizedRoom[] = sortedRooms.map((room, index) => {
    const newId = `R${String(index + 1).padStart(2, "0")}`;
    idMap.set(room.id, newId);

    const classified = classificationById.get(room.id);
    const type = normalizeRoomType(classified?.type);
    const name = normalizeRoomName(
      classified?.name || room.suggestedName,
      type,
      index + 1,
    );
    const areaPx = polygonAreaPx(room.polygon);
    const fallbackAreaM2 = areaPx / (scale.pxPerM * scale.pxPerM);
    const areaM2 = typeof room.areaM2 === "number" && room.areaM2 > 0
      ? round(room.areaM2, 2)
      : round(fallbackAreaM2, 2);
    const areaCm2 = areaM2 * 10_000;
    const color = colorForIndex(index);

    return {
      id: newId,
      sourceId: room.id,
      name,
      type,
      color,
      label: `${name} - ${areaM2.toFixed(2)} m²`,
      polygon: room.polygon,
      centroid: roundPoint(polygonCentroid(room.polygon)),
      areaM2,
      areaCm2: round(areaCm2, 2),
      confidence: clamp01(average([room.confidence, classified?.confidence])),
    };
  });

  if (rooms.length === 0) {
    warnings.push("Gemini did not return valid closed room polygons.");
  }

  const doors = normalizeOpenings(
    openings.doors ?? [],
    "D",
    idMap,
    imageWidthPx,
    imageHeightPx,
  );
  const windows = normalizeOpenings(
    openings.windows ?? [],
    "W",
    idMap,
    imageWidthPx,
    imageHeightPx,
  );

  const outerOutline = sanitizePolygon(
    geometry.outerOutline ?? [],
    imageWidthPx,
    imageHeightPx,
  );

  const roomAreaSum = rooms.reduce((total, room) => total + room.areaM2, 0);
  const outlinePixelArea = outerOutline.length >= 3
    ? polygonAreaPx(outerOutline)
    : 0;
  const roomPixelAreaSum = sourceRooms.reduce(
    (total, room) => total + polygonAreaPx(room.polygon),
    0,
  );
  const footprintFromOutline = outlinePixelArea > 0
    ? outlinePixelArea / (scale.pxPerM * scale.pxPerM)
    : 0;

  const modelTotalAreaM2 =
    typeof geometry.totalAreaM2 === "number" && geometry.totalAreaM2 > 0
      ? geometry.totalAreaM2
      : 0;
  const trustedTotalAreaM2 = modelTotalAreaM2 > 0
    ? modelTotalAreaM2
    : footprintFromOutline > 0
    ? footprintFromOutline
    : roomAreaSum;

  const referencePixelArea = outlinePixelArea > 0
    ? outlinePixelArea
    : roomPixelAreaSum;
  let workingScale = scale;
  if (trustedTotalAreaM2 > 0 && referencePixelArea > 0) {
    const calibratedPxPerM = Math.sqrt(
      referencePixelArea / trustedTotalAreaM2,
    );
    const ratio = calibratedPxPerM / scale.pxPerM;
    if (
      Number.isFinite(calibratedPxPerM) && calibratedPxPerM > 0 &&
      (ratio > 1.25 || ratio < 0.8)
    ) {
      workingScale = {
        pxPerM: calibratedPxPerM,
        source: scale.source,
        confidence: clamp01(scale.confidence * 0.8),
        explanation:
          `Scale recalibrated from trusted total area (${trustedTotalAreaM2.toFixed(2)} m²) and ${
            outlinePixelArea > 0 ? "outer outline" : "room polygon"
          } pixel area; original pxPerM=${scale.pxPerM.toFixed(2)} produced inconsistent geometry.`,
      };
      warnings.push(
        "Inferred scale was inconsistent with the reported total area; recalibrated for wall and glass measurements.",
      );
    }
  }

  const walls = normalizeWalls(
    geometry.walls ?? [],
    imageWidthPx,
    imageHeightPx,
    workingScale.pxPerM,
  );
  const glazing = normalizeGlazing(
    geometry.glazing ?? [],
    walls,
    idMap,
    imageWidthPx,
    imageHeightPx,
    workingScale.pxPerM,
  );

  const wallAreaFromSegments = walls.reduce(
    (total, wall) => total + wall.areaM2,
    0,
  );
  const glassAreaFromSegments = glazing.reduce(
    (total, segment) => total + segment.areaM2,
    0,
  );

  const totalFootprintAreaM2 = round(
    trustedTotalAreaM2 > 0
      ? trustedTotalAreaM2
      : footprintFromOutline > 0
      ? footprintFromOutline
      : roomAreaSum + wallAreaFromSegments,
    2,
  );

  const roomCoverageRatio = totalFootprintAreaM2 > 0
    ? roomAreaSum / totalFootprintAreaM2
    : 0;
  const canFallbackToRoomDelta = roomAreaSum > 0 &&
    totalFootprintAreaM2 > roomAreaSum &&
    roomCoverageRatio >= 0.6;
  const fallbackWallArea = canFallbackToRoomDelta
    ? totalFootprintAreaM2 - roomAreaSum
    : 0;
  const wallAreaM2 = round(
    wallAreaFromSegments > 0 ? wallAreaFromSegments : fallbackWallArea,
    2,
  );
  const glassAreaM2 = round(glassAreaFromSegments, 2);
  const floorAreaM2 = round(
    Math.max(0, totalFootprintAreaM2 - wallAreaM2),
    2,
  );

  console.log("[analyze-floorplan] area summary", {
    modelTotalAreaM2,
    footprintFromOutline: round(footprintFromOutline, 2),
    roomAreaSum: round(roomAreaSum, 2),
    roomCoverageRatio: round(roomCoverageRatio, 2),
    trustedTotalAreaM2: round(trustedTotalAreaM2, 2),
    totalFootprintAreaM2,
    wallAreaFromSegments: round(wallAreaFromSegments, 2),
    glassAreaFromSegments: round(glassAreaFromSegments, 2),
    wallAreaM2,
    glassAreaM2,
    floorAreaM2,
    wallSegmentCount: walls.length,
    glazingSegmentCount: glazing.length,
  });

  if (wallAreaM2 <= 0) {
    warnings.push(
      "Wall area is zero — the model did not return usable wall segments.",
    );
  }
  if (glassAreaM2 <= 0) {
    warnings.push(
      "Glass area is zero — the model did not return usable glazing segments.",
    );
  }

  const summary = summarize(
    rooms,
    doors,
    windows,
    trustedTotalAreaM2,
    {
      roomAreaM2: round(roomAreaSum, 2),
      wallAreaM2,
      glassAreaM2,
      floorAreaM2,
      totalFootprintAreaM2,
    },
  );

  scale.pxPerM = workingScale.pxPerM;
  scale.source = workingScale.source;
  scale.confidence = workingScale.confidence;
  scale.explanation = workingScale.explanation;

  return {
    imageWidthPx,
    imageHeightPx,
    scale,
    rooms,
    doors,
    windows,
    walls,
    glazing,
    outerOutline,
    summary,
    warnings,
  };
}

function resolveScale(
  _request: AnalyzeFloorPlanRequest,
  inferred: GeminiScale | undefined,
  _totalPixelArea: number,
): Required<GeminiScale> {
  if (inferred?.pxPerM && inferred.pxPerM > 0) {
    return {
      pxPerM: inferred.pxPerM,
      source: inferred.source ?? "dimensionLabel",
      confidence: clamp01(inferred.confidence ?? 0.65),
      explanation: inferred.explanation ??
        "Scale inferred by Gemini from visible plan context.",
    };
  }

  return {
    pxPerM: 100,
    source: "fallback",
    confidence: 0.25,
    explanation:
      "No scale was available, so the backend assumed 100 pixels equals 1 metre.",
  };
}

function normalizeOpenings(
  openings: GeminiOpening[],
  prefix: "D" | "W",
  idMap: Map<string, string>,
  imageWidthPx: number,
  imageHeightPx: number,
): NormalizedOpening[] {
  return openings
    .filter((opening) =>
      Number.isFinite(opening.position?.x) &&
      Number.isFinite(opening.position?.y)
    )
    .map((opening, index) => {
      const sourceIds = opening.roomIds ??
        (opening.roomId ? [opening.roomId] : []);

      return {
        id: `${prefix}${String(index + 1).padStart(2, "0")}`,
        position: roundPoint(
          clampPoint(opening.position, imageWidthPx, imageHeightPx),
        ),
        roomIds: sourceIds.map((id) => idMap.get(id) ?? id).filter(Boolean),
        confidence: clamp01(opening.confidence ?? 0.5),
      };
    });
}

function summarize(
  rooms: NormalizedRoom[],
  doors: NormalizedOpening[],
  windows: NormalizedOpening[],
  trustedTotalAreaM2: number,
  areas: {
    roomAreaM2: number;
    wallAreaM2: number;
    glassAreaM2: number;
    floorAreaM2: number;
    totalFootprintAreaM2: number;
  },
): AnalysisSummary {
  const typeCounts = rooms.reduce<Record<string, number>>((counts, room) => {
    counts[room.type] = (counts[room.type] ?? 0) + 1;
    return counts;
  }, {});

  const summed = rooms.reduce((total, room) => total + room.areaM2, 0);
  const totalAreaM2 = round(
    trustedTotalAreaM2 > 0 ? trustedTotalAreaM2 : summed,
    2,
  );

  return {
    totalAreaM2,
    roomAreaM2: areas.roomAreaM2,
    wallAreaM2: areas.wallAreaM2,
    glassAreaM2: areas.glassAreaM2,
    floorAreaM2: areas.floorAreaM2,
    netAreaM2: areas.floorAreaM2,
    totalFootprintAreaM2: areas.totalFootprintAreaM2,
    roomCount: rooms.length,
    doorCount: doors.length,
    windowCount: windows.length,
    typeCounts,
  };
}

function normalizePolyline(
  points: Point[],
  imageWidthPx: number,
  imageHeightPx: number,
): Point[] {
  return points
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => roundPoint(clampPoint(point, imageWidthPx, imageHeightPx)));
}

function normalizeWalls(
  walls: GeminiWallSegment[],
  imageWidthPx: number,
  imageHeightPx: number,
  pxPerM: number,
): NormalizedWall[] {
  if (!Array.isArray(walls) || pxPerM <= 0) return [];
  return walls
    .map((wall, index) => {
      const polyline = normalizePolyline(
        wall.polyline ?? [],
        imageWidthPx,
        imageHeightPx,
      );
      if (polyline.length < 2) return null;
      const thicknessM = Number.isFinite(wall.thicknessM) &&
          (wall.thicknessM as number) > 0
        ? (wall.thicknessM as number)
        : 0.12;
      const lengthM = polylineLengthPx(polyline) / pxPerM;
      const areaM2 = round(lengthM * thicknessM, 2);
      return {
        id: wall.id || `WL${String(index + 1).padStart(2, "0")}`,
        polyline,
        thicknessM: round(thicknessM, 3),
        lengthM: round(lengthM, 2),
        areaM2,
        confidence: clamp01(wall.confidence ?? 0.5),
      } satisfies NormalizedWall;
    })
    .filter((wall): wall is NormalizedWall => wall !== null);
}

function normalizeGlazing(
  glazing: GeminiGlazingSegment[],
  walls: NormalizedWall[],
  idMap: Map<string, string>,
  imageWidthPx: number,
  imageHeightPx: number,
  pxPerM: number,
): NormalizedGlazing[] {
  if (!Array.isArray(glazing) || pxPerM <= 0) return [];
  const fallbackThickness = walls.length > 0
    ? walls.reduce((total, wall) => total + wall.thicknessM, 0) / walls.length
    : 0.10;
  return glazing
    .map((segment, index) => {
      const polyline = normalizePolyline(
        segment.polyline ?? [],
        imageWidthPx,
        imageHeightPx,
      );
      if (polyline.length < 2) return null;
      const thicknessM = Number.isFinite(segment.thicknessM) &&
          (segment.thicknessM as number) > 0
        ? (segment.thicknessM as number)
        : fallbackThickness;
      const lengthM = polylineLengthPx(polyline) / pxPerM;
      const areaM2 = round(lengthM * thicknessM, 2);
      const mappedRoomId = segment.roomId
        ? idMap.get(segment.roomId) ?? segment.roomId
        : undefined;
      const normalized: NormalizedGlazing = {
        id: segment.id || `GL${String(index + 1).padStart(2, "0")}`,
        polyline,
        thicknessM: round(thicknessM, 3),
        lengthM: round(lengthM, 2),
        areaM2,
        confidence: clamp01(segment.confidence ?? 0.5),
      };
      if (mappedRoomId) normalized.roomId = mappedRoomId;
      return normalized;
    })
    .filter((segment): segment is NormalizedGlazing => segment !== null);
}

function sanitizePolygon(
  points: Point[],
  imageWidthPx: number,
  imageHeightPx: number,
): Point[] {
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => roundPoint(clampPoint(point, imageWidthPx, imageHeightPx)));
}

function clampPoint(
  point: Point,
  imageWidthPx: number,
  imageHeightPx: number,
): Point {
  const maxX = imageWidthPx > 0 ? imageWidthPx : Number.MAX_SAFE_INTEGER;
  const maxY = imageHeightPx > 0 ? imageHeightPx : Number.MAX_SAFE_INTEGER;

  return {
    x: Math.max(0, Math.min(maxX, point.x)),
    y: Math.max(0, Math.min(maxY, point.y)),
  };
}

function normalizeRoomType(type: string | undefined): RoomType {
  return roomTypes.includes(type as RoomType) ? (type as RoomType) : "other";
}

function normalizeRoomName(
  name: string | undefined,
  type: RoomType,
  index: number,
): string {
  const cleaned = name?.replace(/[^a-zA-Z0-9 /-]/g, " ").replace(/\s+/g, " ")
    .trim();
  if (cleaned) return titleCase(cleaned).slice(0, 42);
  return `${titleCase(type.replace(/([A-Z])/g, " $1"))} ${index}`;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function colorForIndex(index: number): string {
  const hue = (index * 137.508 + 18) % 360;
  return hslToHex(hue, 88, 56);
}

function hslToHex(
  hue: number,
  saturationPercent: number,
  lightnessPercent: number,
): string {
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const m = lightness - chroma / 2;
  const [red, green, blue] = huePrime < 1
    ? [chroma, x, 0]
    : huePrime < 2
    ? [x, chroma, 0]
    : huePrime < 3
    ? [0, chroma, x]
    : huePrime < 4
    ? [0, x, chroma]
    : huePrime < 5
    ? [x, 0, chroma]
    : [chroma, 0, x];

  return `#${
    [red, green, blue]
      .map((channel) =>
        Math.round((channel + m) * 255).toString(16).padStart(2, "0")
      )
      .join("")
  }`;
}

function average(values: Array<number | undefined>): number {
  const finiteValues = values.filter((value): value is number =>
    Number.isFinite(value)
  );
  if (finiteValues.length === 0) return 0.5;
  return finiteValues.reduce((total, value) => total + value, 0) /
    finiteValues.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, round(value, 3)));
}

function roundPoint(point: Point): Point {
  return {
    x: round(point.x, 2),
    y: round(point.y, 2),
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
