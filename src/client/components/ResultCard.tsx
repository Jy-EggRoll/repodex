import type { ReactNode } from "react";
import { CARD_SHELL, CARD_TRANSITION } from "../ui";

const TITLE_CLASS = "text-kumo-strong text-lg leading-tight font-semibold break-all";

interface ResultCardProps {
  href: string;
  /** Plain-text title (repo name, etc.); mutually exclusive with titleHtml */
  title?: string;
  /** Highlight HTML returned by the backend; dangerouslySetInnerHTML is used nowhere else but here */
  titleHtml?: string;
  subtitle: string;
  meta: string;
  badge: ReactNode;
  /** Entry animation delay (ms), staggered by list index; omitted means no delay */
  enterDelayMs?: number;
}

export default function ResultCard({
  href,
  title,
  titleHtml,
  subtitle,
  meta,
  badge,
  enterDelayMs,
}: ResultCardProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={enterDelayMs ? { animationDelay: `${enterDelayMs}ms` } : undefined}
      className={`card-enter block h-full ${CARD_SHELL} ${CARD_TRANSITION} hover:shadow-sm active:scale-[0.99]`}
    >
      <div className="flex h-full w-full items-start justify-between gap-4">
        <div className="min-w-0 flex-1 text-left">
          {titleHtml !== undefined ? (
            <div className={TITLE_CLASS} dangerouslySetInnerHTML={{ __html: titleHtml }} />
          ) : (
            <div className={TITLE_CLASS}>{title}</div>
          )}
          <div className="text-kumo-subtle mt-1 text-xs break-words break-all whitespace-pre-wrap">
            {subtitle}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-start">
          <div className="text-kumo-subtle text-sm">{meta}</div>
          <div className="mt-2">{badge}</div>
        </div>
      </div>
    </a>
  );
}

/** Loading placeholder: a pulse block the same size as a card, reusable directly inside the grid. */
export function CardSkeleton() {
  return (
    <div aria-hidden className={`${CARD_SHELL} h-[76px]`}>
      <div className="bg-kumo-fill h-5 w-2/3 animate-pulse rounded" />
      <div className="bg-kumo-fill mt-2 h-3 w-1/2 animate-pulse rounded" />
    </div>
  );
}
