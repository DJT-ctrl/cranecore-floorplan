export type AnalysisMode = "normal" | "enhanced";

export type StepId = "geometry" | "classification" | "openings" | "annotation";
export type StepStatus = "idle" | "running" | "done";

export interface AnalysisStepState {
  status: StepStatus;
  label: string;
}

export type AnalysisSteps = Record<StepId, AnalysisStepState>;

export interface ProgressStepEvent {
  type: "step_start" | "step_done";
  step: StepId;
  label?: string;
  progress: number;
}

export interface ProgressCompleteEvent {
  type: "complete";
  result: FloorPlanAnalysis;
  progress: number;
}

export interface ProgressErrorEvent {
  type: "error";
  error: string;
}

export type ProgressEvent =
  | ProgressStepEvent
  | ProgressCompleteEvent
  | ProgressErrorEvent;

export interface PreparedImage {
  base64: string;
  dataUrl: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
  originalName: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface RoomResult {
  id: string;
  sourceId: string;
  name: string;
  type: string;
  color: string;
  label: string;
  polygon: Point[];
  centroid: Point;
  areaM2: number;
  areaCm2: number;
  confidence: number;
}

export interface OpeningResult {
  id: string;
  position: Point;
  roomIds: string[];
  confidence: number;
}

export interface WallResult {
  id: string;
  polyline: Point[];
  thicknessM: number;
  lengthM: number;
  areaM2: number;
  confidence: number;
}

export interface GlazingResult {
  id: string;
  polyline: Point[];
  thicknessM: number;
  lengthM: number;
  areaM2: number;
  roomId?: string;
  confidence: number;
}

export interface FloorPlanAnalysis {
  image: {
    widthPx: number;
    heightPx: number;
    mimeType: string;
  };
  annotatedImage?: {
    base64: string;
    mimeType: string;
    model: string;
    notes?: string;
  };
  model: {
    mode: AnalysisMode;
    requestedAnalysisModel: string;
    actualAnalysisModel: string;
    imageModel: string;
  };
  scale: {
    pxPerM: number;
    source: string;
    confidence: number;
    explanation: string;
  };
  rooms: RoomResult[];
  doors: OpeningResult[];
  windows: OpeningResult[];
  walls: WallResult[];
  glazing: GlazingResult[];
  outerOutline: Point[];
  summary: {
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
  };
  warnings: string[];
}