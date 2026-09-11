import type { ReactNode } from "react";

interface ResultCardProps {
  href: string;
  /** 纯文本标题（仓库名等），与 titleHtml 二选一 */
  title?: string;
  /** 后端返回的高亮 HTML，只在此处做 dangerouslySetInnerHTML */
  titleHtml?: string;
  subtitle: string;
  meta: string;
  badge: ReactNode;
  /** 进入动画延迟（ms），列表按下标错峰传入；缺省无延迟 */
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
      className="border-kumo-line bg-kumo-elevated card-enter block h-full rounded-lg border p-3 transition-all hover:shadow-sm active:scale-[0.99]"
    >
      <div className="flex h-full w-full items-start justify-between gap-4">
        <div className="min-w-0 flex-1 text-left">
          {titleHtml !== undefined ? (
            <div
              className="text-kumo-strong text-lg leading-tight font-semibold break-all"
              dangerouslySetInnerHTML={{ __html: titleHtml }}
            />
          ) : (
            <div className="text-kumo-strong text-lg leading-tight font-semibold break-all">{title}</div>
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

/** 加载占位：与卡片同尺寸的脉冲块，网格内直接复用。 */
export function CardSkeleton() {
  return (
    <div aria-hidden className="border-kumo-line bg-kumo-elevated h-[76px] rounded-lg border p-3">
      <div className="bg-kumo-fill h-5 w-2/3 animate-pulse rounded" />
      <div className="bg-kumo-fill mt-2 h-3 w-1/2 animate-pulse rounded" />
    </div>
  );
}
