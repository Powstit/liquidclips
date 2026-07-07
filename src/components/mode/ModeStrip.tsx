// Mode strip shown above the four Home task cards.
// Changes visible guidance; does not block the user.

import { useModeStore, type UserMode } from "../../state/mode";

const OPTIONS: { mode: UserMode; label: string }[] = [
  { mode: "clipper", label: "I am clipping for a campaign" },
  { mode: "agency", label: "I am creating a campaign" },
];

export function ModeStrip(): JSX.Element {
  const { mode, setMode } = useModeStore();

  return (
    <div
      className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper-elev p-1.5"
      role="group"
      aria-label="Select user mode"
    >
      {OPTIONS.map((option) => {
        const active = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => setMode(option.mode)}
            aria-pressed={active}
            className={[
              "rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150",
              active
                ? "bg-fuchsia text-white shadow-[var(--glow-sm)]"
                : "text-text-secondary hover:bg-paper hover:text-ink",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
