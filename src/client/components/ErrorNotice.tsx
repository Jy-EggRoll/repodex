import { Banner, Button } from "@cloudflare/kumo";

interface ErrorNoticeProps {
  title: string;
  message: string;
  /** 传入后显示「重试」按钮 */
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export default function ErrorNotice({ title, message, onRetry, retryDisabled }: ErrorNoticeProps) {
  return (
    <div className="mt-4">
      <Banner variant="error" title={title} description={message} />
      {onRetry && (
        <div className="mt-2">
          <Button variant="secondary" size="sm" disabled={retryDisabled} onClick={onRetry}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
