import { Upload } from "lucide-react";

interface ImageDropZoneProps {
  isPreparing: boolean;
  onFile: (file: File) => void;
}

export function ImageDropZone({ isPreparing, onFile }: ImageDropZoneProps) {
  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
    if (file) onFile(file);
  };

  return (
    <label
      className="drop-zone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      title="Paste, drag, or select a floor plan image"
    >
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
      <span className="drop-icon" aria-hidden="true">
        <Upload size={36} />
      </span>
      <span className="drop-title">{isPreparing ? "Preparing grayscale image" : "Drop your blueprint here"}</span>
      <span className="drop-subtitle">Supports PNG, JPEG, BMP, WebP, and screenshots up to 50 MB</span>
      <span className="browse-button">Browse files</span>
    </label>
  );
}