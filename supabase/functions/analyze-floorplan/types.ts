export type AnalysisMode = "normal" | "enhanced";

export type RoomType =
  | "bedroom"
  | "bathroom"
  | "kitchen"
  | "hall"
  | "livingRoom"
  | "diningRoom"
  | "corridor"
  | "closet"
  | "utility"
  | "office"
  | "other";

export interface Point {
  x: number;
  y: number;
}

export interface AnalyzeFloorPlanRequest {
  imageBase64: string;
  mimeType?: string;
  imageWidthPx?: number;
  imageHeightPx?: number;
  mode?: AnalysisMode;
  pxPerM?: number;
  knownTotalAreaM2?: number;
  notes?: string;
}

export interface GeminiImageInput {
  base64: string;
  mimeType: string;
}

export interface GeminiScale {
  pxPerM?: number;
  source?:
    | "dimensionLabel"
    | "fallback"
    | "userOverride"
    | "knownTotalArea"
    | "unknown";
  confidence?: number;
  explanation?: string;
}

export interface GeminiGeometryRoom {
  id: string;
  suggestedName?: string;
  polygon: Point[];
  areaM2?: number;
  dimensionsLabelsFound?: string[];
  confidence?: number;
}

export interface GeminiWallSegment {
  id?: string;
  polyline: Point[];
  thicknessM?: number;
  confidence?: number;
}

export interface GeminiGlazingSegment {
  id?: string;
  polyline: Point[];
  thicknessM?: number;
  roomId?: string;
  confidence?: number;
}

export interface GeminiGeometryResult {
  imageWidthPx?: number;
  imageHeightPx?: number;
  totalAreaM2?: number;
  inferredScale?: GeminiScale;
  rooms?: GeminiGeometryRoom[];
  notes?: string[];
  outerOutline?: Point[];
  walls?: GeminiWallSegment[];
  glazing?: GeminiGlazingSegment[];
}

export interface GeminiClassificationRoom {
  id: string;
  name?: string;
  type?: RoomType;
  confidence?: number;
}

export interface GeminiClassificationResult {
  rooms?: GeminiClassificationRoom[];
}

export interface GeminiOpening {
  id?: string;
  position: Point;
  roomIds?: string[];
  roomId?: string;
  confidence?: number;
}

export interface GeminiOpeningsResult {
  doors?: GeminiOpening[];
  windows?: GeminiOpening[];
}

export interface NormalizedRoom {
  id: string;
  sourceId: string;
  name: string;
  type: RoomType;
  color: string;
  label: string;
  polygon: Point[];
  centroid: Point;
  areaM2: number;
  areaCm2: number;
  confidence: number;
}

export interface NormalizedOpening {
  id: string;
  position: Point;
  roomIds: string[];
  confidence: number;
}

export interface NormalizedWall {
  id: string;
  polyline: Point[];
  thicknessM: number;
  lengthM: number;
  areaM2: number;
  confidence: number;
}

export interface NormalizedGlazing {
  id: string;
  polyline: Point[];
  thicknessM: number;
  lengthM: number;
  areaM2: number;
  roomId?: string;
  confidence: number;
}

export interface AnalysisSummary {
  totalAreaM2: number;
  roomAreaM2: number;
  wallAreaM2: number;
  glassAreaM2: number;
  netAreaM2: number;
  floorAreaM2: number;
  totalFootprintAreaM2: number;
  roomCount: number;
  doorCount: number;
  windowCount: number;
  typeCounts: Record<string, number>;
}

export interface AnnotatedImageResult {
  base64: string;
  mimeType: string;
  model: string;
  notes?: string;
}

export interface AnalyzeFloorPlanResponse {
  image: {
    widthPx: number;
    heightPx: number;
    mimeType: string;
  };
  annotatedImage?: AnnotatedImageResult;
  model: {
    mode: AnalysisMode;
    requestedAnalysisModel: string;
    actualAnalysisModel: string;
    imageModel: string;
  };
  scale: Required<GeminiScale>;
  rooms: NormalizedRoom[];
  doors: NormalizedOpening[];
  windows: NormalizedOpening[];
  walls: NormalizedWall[];
  glazing: NormalizedGlazing[];
  outerOutline: Point[];
  summary: AnalysisSummary;
  warnings: string[];
}
