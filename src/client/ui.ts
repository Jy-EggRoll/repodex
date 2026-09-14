// Shared UI constants: Tailwind fragments and motion parameters reused across components

// —— Paging / scrolling ——
export const PAGE_SIZE = 100;
export const SKELETON_COUNT = 6;
export const SCROLL_MARGIN = "400px";

// —— Staggered list entry ——
const STAGGER_STEP_MS = 40;
const STAGGER_MAX = 11;

/** Entry delay (ms) for the list item at `index`; clamped past the cap so the tail never accumulates unbounded delay. */
export function staggerDelayMs(index: number): number {
  return Math.min(index, STAGGER_MAX) * STAGGER_STEP_MS;
}

// —— Layout ——
export const CONTENT_MAX_W = "max-w-5xl xl:max-w-7xl";
export const RESULT_GRID = "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3";
export const SHELL_PADDING = "p-4 sm:p-6";
export const MIN_SEARCH_HEIGHT = "min-h-[56px]";
export const DIALOG_MAX_H = "max-h-[60vh]";

// —— Panels / cards / text ——
export const PANEL = "bg-kumo-base rounded-xl";
export const HEADER_SHADOW = "shadow-sm";
export const CONTENT_SHADOW = "shadow-md";
export const CARD_SHELL = "border-kumo-line bg-kumo-elevated rounded-lg border p-3";
export const CARD_TRANSITION = "transition-[box-shadow,scale]";
export const PAGE_TITLE = "text-kumo-strong mb-4 text-2xl font-bold";
