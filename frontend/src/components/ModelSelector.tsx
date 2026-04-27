import type { AnalysisMode } from "../types";

interface ModelSelectorProps {
  value: AnalysisMode;
  onChange: (value: AnalysisMode) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Model mode">
      <span>Mode</span>
      <button
        className={value === "normal" ? "mode-option active" : "mode-option"}
        type="button"
        onClick={() => onChange("normal")}
        aria-pressed={value === "normal"}
        title="Use the configured Gemini 3.1 analysis model"
      >
        <span>Normal</span>
      </button>
      <button
        className="mode-switch"
        type="button"
        onClick={() => onChange(value === "normal" ? "enhanced" : "normal")}
        aria-label="Toggle model mode"
      >
        <span className={value === "enhanced" ? "switch-knob enhanced" : "switch-knob"} />
      </button>
      <button
        className={value === "enhanced" ? "mode-option active" : "mode-option"}
        type="button"
        onClick={() => onChange("enhanced")}
        aria-pressed={value === "enhanced"}
        title="Use Gemini 2.5 Pro for the analysis steps"
      >
        <span>Enhanced</span>
      </button>
    </div>
  );
}