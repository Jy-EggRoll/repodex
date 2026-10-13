import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * Local content-width preference.
 *
 * Its meaning is "how wide this device likes the view": a narrow screen and a wide screen want
 * different widths, so it lives in the browser rather than on the server — syncing it across
 * devices would be the wrong abstraction. The key sits next to "theme" and "lang" with no prefix,
 * keeping one naming scheme. The value is a plain px number (no unit), and every read validates
 * it, so hand-edited or stale values count as never set.
 */
const CONTENT_WIDTH_KEY = "content-width";

/**
 * A floor, because the layout stops working below it: tables and forms break apart when squeezed.
 *
 * When the window itself is narrower than the floor (mouse users under 640px), the rendered width
 * is narrower still: that is "cramped beats broken", not a bug. Touch devices hide the handles
 * entirely, so they never hit this.
 */
const CONTENT_WIDTH_MIN = 640;

/** Step size for keyboard fine-tuning. */
const KEYBOARD_STEP = 20;

/**
 * Handle: a full-height transparent hit strip, whose visible part is the short bar drawn by `:after`.
 *
 * `--repodex-handle-y` is written by pointermove from the cursor position, which is what makes the
 * bar follow the pointer; before a drag it is the only hint that this edge can be dragged, so the
 * hover state must keep updating it. Move that update behind the drag check and the bar falls back
 * to the vertical midpoint.
 *
 * Every class name here must be a literal: Tailwind only scans statically, so classes built from a
 * template string (`after:h-[${n}px]`) are dropped whole and the style silently disappears. To
 * centre the bar on the cursor, hand that job to CSS via `-translate-y-1/2` instead of computing
 * half its length in JS.
 *
 * The bar is Kumo's `kumo-contrast` (`--color-kumo-contrast`, oklch 8.5% light / 98.5% dark) at a
 * low opacity. The obvious pick, `kumo-interact` (87% / 37.1%), is visibly too faint in the light
 * theme: on the white panel it differs by roughly 8% lightness, which the eye barely registers even
 * at full opacity. contrast starts from the opposite end — near-black on light, near-white on dark —
 * so one low opacity works in both themes instead of being tuned per theme.
 */
const HANDLE_CLASS =
  "absolute top-0 bottom-0 z-10 w-2.5 cursor-col-resize touch-none select-none outline-none " +
  "after:absolute after:left-1/2 after:h-[72px] after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-kumo-contrast " +
  // The bar fades in on hover and focus, then firms up while dragging: its brightness is the affordance.
  "after:top-[var(--repodex-handle-y,50%)] after:content-[''] after:opacity-0 after:transition-opacity after:duration-[var(--motion-fade)] after:ease-[var(--motion-ease)] " +
  "hover:after:opacity-30 focus-visible:after:opacity-30 active:after:opacity-50 " +
  // Reduced motion: silence this one transition only, without joining the global whitelist in main.css.
  "motion-reduce:after:transition-none " +
  // No real hover on touch, so a visible handle would only invite mis-taps.
  "pointer-coarse:hidden";

/**
 * Width before the first drag, taken straight from Tailwind's 6xl container token (`--container-6xl: 72rem`).
 *
 * Two deliberate choices. One, no pixel value: the default width belongs to the design token, and
 * copying it as a number would define it in two places, so a token change would never reach this
 * component. Two, the class only applies when there is no local preference: `max-width` also caps
 * the inline width, so keeping it on would pull a widened width back to 72rem.
 */
const DEFAULT_WIDTH_CLASS = "max-w-6xl";

/** Clamp to a valid width; the caller guarantees a finite input. */
function clampWidth(px: number): number {
  return Math.max(CONTENT_WIDTH_MIN, Math.round(px));
}

/**
 * Parse the local preference: missing, non-numeric and non-positive all mean null, i.e. "use the default width".
 *
 * Returning null rather than a fallback number keeps the default width at a single source (see
 * DEFAULT_WIDTH_CLASS); a fallback here would make the two disagree.
 */
function parseContentWidth(raw: string | null): number | null {
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return clampWidth(parsed);
}

function readWidth(): number | null {
  try {
    return parseContentWidth(window.localStorage.getItem(CONTENT_WIDTH_KEY));
  } catch {
    // Private mode and the like expose no localStorage: fall back to the default rather than fail to render.
    return null;
  }
}

function writeWidth(px: number): void {
  try {
    window.localStorage.setItem(CONTENT_WIDTH_KEY, String(px));
  } catch {
    // A failed write only costs persistence; this adjustment still applies.
  }
}

/** Forget the local preference, which returns the width to its default. */
function clearWidth(): void {
  try {
    window.localStorage.removeItem(CONTENT_WIDTH_KEY);
  } catch {
    // As above: a failed removal only means the width is back on the next visit.
  }
}

/**
 * Content width container with drag handles.
 *
 * The width is the user's call: one handle per side, a small bar follows the cursor on hover, and
 * dragging changes the width symmetrically (the container is centred, so dragging out by Δx widens
 * by 2Δx). Double-click or Home resets, arrow keys fine-tune once a handle has focus. On narrow
 * screens `max-width: 100%` caps the width, so not being able to drag wider is the screen running
 * out, not an error.
 *
 * The header, the panel and the footer share this one width: before the first drag there is no
 * inline width and DEFAULT_WIDTH_CLASS handles it, so "how wide by default" exists in one place.
 */
export default function ResizableContent({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [width, setWidth] = useState<number | null>(readWidth);

  /**
   * What truly fits right now: dragging to the edge fills it, so what is stored is what is seen.
   *
   * It must read the parent's content box rather than `clientWidth`: the latter includes the
   * horizontal padding, while `max-width: 100%` resolves against the content box. Using
   * `clientWidth` stores a wider value than the one rendered when dragged to the edge (1265 stored
   * against 1217 on screen), and the next arrow key then changes the inline value with nothing
   * moving on screen.
   */
  function maxAvailable(): number {
    const parent = frameRef.current?.parentElement;
    if (parent === null || parent === undefined) return window.innerWidth;
    const style = getComputedStyle(parent);
    return (
      parent.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)
    );
  }

  /** Starting point for arrow keys: the preference when there is one, otherwise the rendered width. */
  function currentWidth(): number {
    return width ?? frameRef.current?.getBoundingClientRect().width ?? 0;
  }

  function apply(next: number): void {
    const value = clampWidth(Math.min(next, maxAvailable()));
    setWidth(value);
    writeWidth(value);
  }

  /**
   * Reset means forget the preference, not remember the current screen cap:
   * otherwise a single reset on a narrow screen would make the width unreachable on a wide one.
   */
  function reset(): void {
    clearWidth();
    setWidth(null);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    const frame = frameRef.current;
    if (frame === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startWidth: frame.getBoundingClientRect().width,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    // Needed on hover too: this line alone is what makes the bar follow the cursor.
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--repodex-handle-y",
      `${event.clientY - box.top}px`,
    );

    const drag = dragRef.current;
    if (drag === null) return;
    const direction = event.currentTarget.dataset.side === "left" ? -1 : 1;
    apply(drag.startWidth + (event.clientX - drag.startX) * direction * 2);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      apply(currentWidth() + KEYBOARD_STEP);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      apply(currentWidth() - KEYBOARD_STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      reset();
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6">
      <div
        ref={frameRef}
        className={`relative mx-auto ${width === null ? DEFAULT_WIDTH_CLASS : ""}`}
        style={width === null ? undefined : { width, maxWidth: "100%" }}
      >
        {children}
        {(["left", "right"] as const).map((side) => (
          <div
            key={side}
            role="separator"
            // ARIA separators report their position through valuenow, and here the width is what the
            // user cares about, so report the width itself; before the first drag there is no position
            // to report, only the default width.
            aria-orientation="vertical"
            aria-label={t("Drag to resize content width")}
            aria-valuenow={width ?? undefined}
            aria-valuemin={CONTENT_WIDTH_MIN}
            aria-valuetext={
              width === null
                ? t("Default width")
                : t("{0} pixels", { 0: String(width) })
            }
            title={t("Drag to resize, double-click to reset")}
            tabIndex={0}
            data-side={side}
            className={`${HANDLE_CLASS} ${side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={reset}
            onKeyDown={onKeyDown}
          />
        ))}
      </div>
    </div>
  );
}
