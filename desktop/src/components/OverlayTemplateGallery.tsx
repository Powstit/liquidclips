// ship-lens v0.7.14: OverlayTemplateGallery
// Pre-made reaction overlay templates for ClipPreview.
// Simple structured overlays: PIP positions, side-by-side, react overlay.
// No webcam recording — just static/structured overlay positioning.

interface OverlayTemplate {
  id: string;
  name: string;
  description: string;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left" | "side-right" | "side-left" | "full-bottom" | "react-overlay";
  size: "sm" | "md" | "lg" | "full";
  shape: "rectangle" | "rounded" | "circle" | "pill";
  border?: string;
  preview: string; // CSS class or inline style for the preview box
}

const TEMPLATES: OverlayTemplate[] = [
  {
    id: "pip-br",
    name: "PIP Bottom-Right",
    description: "Small window in the bottom-right corner",
    position: "bottom-right",
    size: "sm",
    shape: "rounded",
    preview: "bottom: 12px; right: 12px; width: 25%; height: 25%;",
  },
  {
    id: "pip-bl",
    name: "PIP Bottom-Left",
    description: "Small window in the bottom-left corner",
    position: "bottom-left",
    size: "sm",
    shape: "rounded",
    preview: "bottom: 12px; left: 12px; width: 25%; height: 25%;",
  },
  {
    id: "side-right",
    name: "Side-by-Side Right",
    description: "Split screen with main on left, overlay on right",
    position: "side-right",
    size: "lg",
    shape: "rectangle",
    preview: "right: 0; top: 0; width: 40%; height: 100%;",
  },
  {
    id: "side-left",
    name: "Side-by-Side Left",
    description: "Split screen with main on right, overlay on left",
    position: "side-left",
    size: "lg",
    shape: "rectangle",
    preview: "left: 0; top: 0; width: 40%; height: 100%;",
  },
  {
    id: "react-overlay",
    name: "React Overlay",
    description: "Full overlay with transparency for reaction content",
    position: "react-overlay",
    size: "full",
    shape: "rectangle",
    preview: "inset: 0;",
  },
  {
    id: "pip-tr",
    name: "PIP Top-Right",
    description: "Small window in the top-right corner",
    position: "top-right",
    size: "sm",
    shape: "circle",
    preview: "top: 12px; right: 12px; width: 20%; height: 20%;",
  },
  {
    id: "pip-tl",
    name: "PIP Top-Left",
    description: "Small window in the top-left corner",
    position: "top-left",
    size: "sm",
    shape: "circle",
    preview: "top: 12px; left: 12px; width: 20%; height: 20%;",
  },
  {
    id: "full-bottom",
    name: "Bottom Strip",
    description: "Wide strip at the bottom of the video",
    position: "full-bottom",
    size: "md",
    shape: "pill",
    preview: "bottom: 12px; left: 5%; right: 5%; height: 20%;",
  },
];

interface OverlayTemplateGalleryProps {
  selectedId?: string;
  onSelect: (template: OverlayTemplate) => void;
  onClose: () => void;
}

export function OverlayTemplateGallery({ selectedId, onSelect, onClose }: OverlayTemplateGalleryProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
          Overlay templates
        </span>
        <button
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-full text-text-tertiary transition-colors hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((template) => {
          const isSelected = template.id === selectedId;
          return (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              className={`flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-all ${
                isSelected
                  ? "border-fuchsia bg-fuchsia/10"
                  : "border-line bg-paper hover:border-fuchsia/50"
              }`}
            >
              {/* Preview box */}
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-paper-deep">
                {/* Main video placeholder */}
                <div className="absolute inset-0 bg-paper-deep" />
                {/* Overlay placeholder */}
                <div
                  className="absolute rounded-md bg-fuchsia/20 border border-fuchsia/30"
                  style={{ ...parsePreview(template.preview) }}
                />
              </div>

              <span className="font-sans text-[12px] font-medium text-ink">
                {template.name}
              </span>
              <span className="font-sans text-[10px] text-text-secondary">
                {template.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Parse a CSS string like "bottom: 12px; right: 12px; width: 25%;" into a style object */
function parsePreview(css: string): React.CSSProperties {
  const style: React.CSSProperties = {};
  css.split(";").forEach((rule) => {
    const [prop, value] = rule.split(":").map((s) => s.trim());
    if (prop && value) {
      (style as Record<string, string>)[prop] = value;
    }
  });
  return style;
}

export type { OverlayTemplate };
