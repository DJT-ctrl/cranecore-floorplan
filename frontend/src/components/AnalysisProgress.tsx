import {
  CheckCircle2,
  DoorOpen,
  ImageIcon,
  Loader2,
  ScanLine,
  Tag,
} from "lucide-react";
import type { AnalysisSteps, StepId } from "../types";

interface StepDef {
  id: StepId;
  defaultLabel: string;
  icon: React.ReactNode;
}

const STEPS: StepDef[] = [
  {
    id: "geometry",
    defaultLabel: "Extracting room geometry",
    icon: <ScanLine size={16} />,
  },
  {
    id: "classification",
    defaultLabel: "Classifying room types",
    icon: <Tag size={16} />,
  },
  {
    id: "openings",
    defaultLabel: "Detecting doors & windows",
    icon: <DoorOpen size={16} />,
  },
  {
    id: "annotation",
    defaultLabel: "Generating annotated image",
    icon: <ImageIcon size={16} />,
  },
];

interface AnalysisProgressProps {
  steps: AnalysisSteps;
  progress: number;
}

export function AnalysisProgress({ steps, progress }: AnalysisProgressProps) {
  const activeStep = STEPS.find((s) => steps[s.id]?.status === "running");
  const doneCount = STEPS.filter((s) => steps[s.id]?.status === "done").length;

  return (
    <div className="analysis-progress">
      {/* Header */}
      <div className="progress-header">
        <span className="progress-title">
          {activeStep
            ? (steps[activeStep.id]?.label ?? activeStep.defaultLabel)
            : doneCount === STEPS.length
            ? "Analysis complete"
            : "Starting analysis"}
        </span>
        <span className="progress-pct">{progress}%</span>
      </div>

      {/* Animated bar */}
      <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step list */}
      <ol className="progress-steps">
        {STEPS.map((step, i) => {
          const state = steps[step.id];
          const status = state?.status ?? "idle";
          const label = state?.label ?? step.defaultLabel;

          return (
            <li key={step.id} className={`progress-step ps-${status}`}>
              <span className="ps-connector" aria-hidden="true">
                {i > 0 && (
                  <span
                    className={`ps-line ${
                      steps[STEPS[i - 1].id]?.status === "done"
                        ? "ps-line-done"
                        : ""
                    }`}
                  />
                )}
              </span>
              <span className="ps-dot" aria-hidden="true">
                {status === "running" ? (
                  <Loader2 size={15} className="spin-icon" />
                ) : status === "done" ? (
                  <CheckCircle2 size={15} />
                ) : (
                  step.icon
                )}
              </span>
              <span className="ps-label">{label}</span>
              {status === "running" && (
                <span className="ps-badge ps-badge-running">Running</span>
              )}
              {status === "done" && (
                <span className="ps-badge ps-badge-done">Done</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
