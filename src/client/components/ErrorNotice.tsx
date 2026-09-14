import { useTranslation } from "react-i18next";
import { Banner, Button } from "@cloudflare/kumo";

interface ErrorNoticeProps {
  title: string;
  message: string;
  /** When provided, shows the "Retry" button */
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export default function ErrorNotice({ title, message, onRetry, retryDisabled }: ErrorNoticeProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-4">
      <Banner variant="error" title={title} description={message} />
      {onRetry && (
        <div className="mt-2">
          <Button variant="secondary" size="sm" disabled={retryDisabled} onClick={onRetry}>
            {t("Retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
