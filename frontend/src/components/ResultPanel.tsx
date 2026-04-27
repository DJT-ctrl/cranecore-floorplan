import { AlertCircle, DoorOpen, Frame, LayoutGrid, Ruler, ScanLine, SquareStack, TableProperties } from "lucide-react";
import type { AnalysisSteps, FloorPlanAnalysis } from "../types";
import { AnalysisProgress } from "./AnalysisProgress";

interface ResultPanelProps {
  analysis?: FloorPlanAnalysis;
  isLoading: boolean;
  progress: number;
  steps: AnalysisSteps;
}

export function ResultPanel({ analysis, isLoading, progress, steps }: ResultPanelProps) {
  if (isLoading) {
    return (
      <aside className="results-panel">
        <AnalysisProgress steps={steps} progress={progress} />
      </aside>
    );
  }

  if (!analysis) {
    return (
      <aside className="results-panel idle-panel">
        <TableProperties size={24} />
        <span>Results will show room labels, square meter areas, counts, and model details.</span>
      </aside>
    );
  }

  const typeCounts = Object.entries(analysis.summary.typeCounts);
  const summary = analysis.summary;
  const fmt = (value: number | undefined) =>
    `${(typeof value === "number" && Number.isFinite(value) ? value : 0).toFixed(2)} m²`;

  return (
    <aside className="results-panel">
      <div className="metric-grid">
        <Metric icon={<Ruler size={18} />} label="Total area" value={fmt(summary.totalAreaM2)} />
        <Metric icon={<LayoutGrid size={18} />} label="Floor area" value={fmt(summary.floorAreaM2 ?? summary.netAreaM2)} />
        <Metric icon={<SquareStack size={18} />} label="Wall area" value={fmt(summary.wallAreaM2)} />
        <Metric icon={<Frame size={18} />} label="Glass area" value={fmt(summary.glassAreaM2)} />
        <Metric icon={<SquareStack size={18} />} label="Rooms" value={String(summary.roomCount ?? 0)} />
        <Metric icon={<DoorOpen size={18} />} label="Doors" value={String(summary.doorCount ?? 0)} />
        <Metric icon={<ScanLine size={18} />} label="Windows" value={String(summary.windowCount ?? 0)} />
      </div>

      <div className="data-section">
        <h2>Rooms</h2>
        <div className="room-list">
          {analysis.rooms.map((room) => (
            <div className="room-row" key={room.id}>
              <span className="swatch" style={{ backgroundColor: room.color }} />
              <div>
                <strong>{room.label}</strong>
                <span>{room.id} · {room.type} · {Math.round((room.confidence ?? 0) * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="data-section two-column-data">
        <div>
          <h2>Room types</h2>
          {typeCounts.length ? (
            <dl className="compact-list">
              {typeCounts.map(([type, count]) => (
                <div key={type}><dt>{type}</dt><dd>{count}</dd></div>
              ))}
            </dl>
          ) : <p className="muted-copy">No room types returned.</p>}
        </div>
        <div>
          <h2>Scale</h2>
          <dl className="compact-list">
            <div><dt>px/m</dt><dd>{analysis.scale?.pxPerM ?? 0}</dd></div>
            <div><dt>source</dt><dd>{analysis.scale?.source ?? "unknown"}</dd></div>
            <div><dt>confidence</dt><dd>{Math.round((analysis.scale?.confidence ?? 0) * 100)}%</dd></div>
          </dl>
        </div>
      </div>

      <div className="data-section model-section">
        <h2>Models</h2>
        <p>Analysis: {analysis.model.actualAnalysisModel}</p>
        <p>Image: {analysis.model.imageModel}</p>
      </div>

      {(analysis.warnings?.length ?? 0) > 0 && (
        <div className="warning-list">
          <AlertCircle size={18} />
          <div>
            {analysis.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        </div>
      )}
    </aside>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}