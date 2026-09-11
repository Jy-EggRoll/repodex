// UI 统一常量：跨组件复用的 Tailwind 片段与动效参数

// —— 分页 / 滚动 ——
export const PAGE_SIZE = 100;
export const SKELETON_COUNT = 6;
export const SCROLL_MARGIN = "400px";

// —— 列表错峰入场 ——
const STAGGER_STEP_MS = 40;
const STAGGER_MAX = 11;

/** 第 index 个列表项的入场延迟（ms）；超过上限后钳制，避免尾部无限叠加。 */
export function staggerDelayMs(index: number): number {
  return Math.min(index, STAGGER_MAX) * STAGGER_STEP_MS;
}

// —— 布局 ——
export const CONTENT_MAX_W = "max-w-5xl xl:max-w-7xl";
export const RESULT_GRID = "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3";
export const SHELL_PADDING = "p-4 sm:p-6";
export const MIN_SEARCH_HEIGHT = "min-h-[56px]";
export const DIALOG_MAX_H = "max-h-[60vh]";

// —— 面板 / 卡片 / 文字 ——
export const PANEL = "bg-kumo-base rounded-xl";
export const HEADER_SHADOW = "shadow-sm";
export const CONTENT_SHADOW = "shadow-md";
export const CARD_SHELL = "border-kumo-line bg-kumo-elevated rounded-lg border p-3";
export const CARD_TRANSITION = "transition-[box-shadow,scale]";
export const PAGE_TITLE = "text-kumo-strong mb-4 text-2xl font-bold";
