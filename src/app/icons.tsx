// Inline stroke icons. Decorative: buttons carry their own accessible names.
const PATHS: Record<string, string> = {
  menu: "M4 6h16M4 12h16M4 18h16",
  reset: "M6 5v14M19 5l-10 7 10 7z",
  play: "M7 4l13 8-13 8z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  step: "M5 5l10 7-10 7zM19 5v14",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  warn: "M12 3l10 18H2zM12 10v5M12 18v.5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  select: "M5 3l14 8-6 2-2 6z",
  move: "M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3",
  spawn: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v8M8 12h8",
  attach: "M3 8h8v8H3zM13 8h8v8h-8zM11 12h2",
  impulse: "M13 2L4 14h7l-1 8 9-12h-7z",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  probe: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  ruler: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const filled = name === "play" || name === "pause";
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
