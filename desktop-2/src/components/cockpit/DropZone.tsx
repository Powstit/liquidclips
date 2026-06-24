// Lane 2 — Home cockpit DropZone.
//
// Cyan-dashed full-room overlay shown while the user drags a file over the
// host surface (Home in v1). Pointer-events disabled so it never swallows
// clicks on the gem-pill, launcher cards, or carousel.
//
// No real file pickup — the parent surface owns the dragHoverActive state
// locally and clears it on dragleave. This is the affordance only.

interface DropZoneProps {
  /** Parent passes the local dragHoverActive flag. */
  active: boolean;
  /** Optional override copy. */
  label?: string;
  /** MIME helper text. */
  formats?: string;
}

export function DropZone({
  active,
  label = "Drop a video to start",
  formats = "MP4 · MOV · WEBM · up to 4 GB",
}: DropZoneProps) {
  return (
    <div
      className={`lc-dropzone${active ? " on" : ""}`}
      data-cockpit-slot="dropzone"
      aria-hidden={!active}
    >
      <div className="lc-dropzone-frame">
        <img
          className="lc-dropzone-invader"
          src="/brand/invaders/grunt.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <div className="lc-dropzone-title">{label}</div>
        <div className="lc-dropzone-formats">{formats}</div>
      </div>
    </div>
  );
}
