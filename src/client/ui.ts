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
// Content width is user-resizable and lives in components/ResizableContent.tsx
// Column count follows the grid's own width, not the viewport: auto-fill packs as many
// 20rem-minimum cards as fit, so widening the content keeps adding columns instead of stopping at a
// fixed ladder of breakpoints. min(20rem, 100%) keeps a single column from overflowing once the grid
// is narrower than 20rem.
export const RESULT_GRID =
  "grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))]";
export const SHELL_PADDING = "p-4 sm:p-6";
export const MIN_SEARCH_HEIGHT = "min-h-[56px]";
export const DIALOG_MAX_H = "max-h-[60vh]";

// —— Panels / cards / text ——
export const PANEL = "bg-kumo-base rounded-xl";
export const HEADER_SHADOW = "shadow-sm";
export const CONTENT_SHADOW = "shadow-md";
export const CARD_SHELL =
  "border-kumo-line bg-kumo-elevated rounded-lg border p-3";
export const CARD_TRANSITION = "transition-[box-shadow,scale]";
export const PAGE_TITLE = "text-kumo-strong mb-4 text-2xl font-bold";
