import type { ReactNode } from "react";
import { useDelayedPresence } from "../hooks";

/**
 * Conditional notice / empty state / panel that must not pop: mounting plays the shared enter
 * animation, and when `show` turns false the element stays for one exit animation before it
 * unmounts.
 */
export default function Fade({
  show,
  className = "",
  children,
}: {
  show: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [present, leaving] = useDelayedPresence(show);
  if (!present) return null;
  return (
    <div
      aria-hidden={leaving || undefined}
      className={`${leaving ? "card-leave" : "card-enter"} ${className}`}
    >
      {children}
    </div>
  );
}
