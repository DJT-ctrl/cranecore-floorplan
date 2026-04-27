import { Download, Image, Loader2 } from "lucide-react";
import type { FloorPlanAnalysis, PreparedImage } from "../types";

interface ImagePreviewProps {
  image?: PreparedImage;
  analysis?: FloorPlanAnalysis;
  isAnalyzing?: boolean;
}

export function ImagePreview({ image, analysis, isAnalyzing }: ImagePreviewProps) {
  const annotatedSource = analysis?.annotatedImage
    ? `data:${analysis.annotatedImage.mimeType};base64,${analysis.annotatedImage.base64}`
    : undefined;

  return (
    <section className="image-workspace" aria-label="Floor plan image workspace">
      <div className="image-pane">
        <div className="pane-toolbar">
          <span><Image size={16} /> Grayscale input</span>
        </div>
        {image ? <img src={image.dataUrl} alt="Grayscale floor plan input" /> : <div className="empty-preview">No image loaded</div>}
      </div>

      <div className="image-pane primary-pane">
        <div className="pane-toolbar">
          <span><Image size={16} /> AI annotated output</span>
          {annotatedSource && (
            <a className="icon-button" href={annotatedSource} download="annotated-floor-plan.png" title="Download annotated image">
              <Download size={17} />
            </a>
          )}
        </div>
        {annotatedSource ? (
          <img src={annotatedSource} alt="AI annotated floor plan" />
        ) : isAnalyzing ? (
          <div className="empty-preview pane-loading">
            <Loader2 size={28} className="spin-icon" />
            <span>Analyzing…</span>
          </div>
        ) : image ? (
          <div className="empty-preview muted">Annotated image will appear here</div>
        ) : (
          <div className="empty-preview">Waiting for a floor plan</div>
        )}
      </div>
    </section>
  );
}