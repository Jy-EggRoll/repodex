import { useEffect, useRef, useState, type AnimationEvent, type CSSProperties } from "react";

/** Exit animation duration; keep in sync with --motion-fast in main.css. */
const EXIT_MS = 180;

/** Keys present in `previous` but missing from `next`, in previous order. */
export function leavingKeys(previous: string[], next: Iterable<string>): string[] {
  const nextSet = new Set(next);
  return previous.filter((key) => !nextSet.has(key));
}

/**
 * Two-phase transition for filtered lists: when items disappear, the previous list stays rendered
 * for one exit animation (fading in place), then settles to the latest target — items that appear
 * there mount fresh and play the shared enter animation. Exiting items can re-enter and cancel.
 */
export function useListTransition<T>(
  items: T[],
  keyOf: (item: T) => string,
  exitMs = EXIT_MS,
): [list: T[], leaving: Set<string>] {
  const [committed, setCommitted] = useState(items);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const leaving = leavingKeys(committed.map(keyOf), items.map(keyOf));
  const list = leaving.length > 0 ? committed : items;
  // Stable dependency: the settle timer restarts only when the leaving set itself changes, so
  // typing during an exit cannot postpone the settle indefinitely (it always uses the latest target)
  const leavingSig = leaving.join("\n");

  useEffect(() => {
    if (!leavingSig) {
      setCommitted((prev) => (prev === itemsRef.current ? prev : itemsRef.current));
      return;
    }
    const timer = setTimeout(() => setCommitted(itemsRef.current), exitMs);
    return () => clearTimeout(timer);
  }, [leavingSig, exitMs]);

  return [list, new Set(leaving)];
}

/**
 * Enter-animation state for one list item: true from mount until the entry animation ends, so
 * later re-renders (e.g. the reflow that follows a settle) cannot replay it.
 */
export function useEnterOnce(delayMs?: number) {
  const [entering, setEntering] = useState(true);
  const style: CSSProperties | undefined =
    entering && delayMs ? { animationDelay: `${delayMs}ms` } : undefined;
  function onAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (event.target === event.currentTarget) setEntering(false);
  }
  return { entering, style, onAnimationEnd };
}
