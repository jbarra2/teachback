import { Button } from "./button";
import { cn } from "./cn";

interface ErrorStateProps {
  title?: string;
  /** Shown to the user, so only fixed text or an ApiError's contract message: never a raw error. */
  message?: string;
  /** Adds a "Try again" button. */
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message = "Please try again in a moment.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-danger px-6 py-10 text-center",
        className,
      )}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
