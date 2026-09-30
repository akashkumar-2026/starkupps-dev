import { Button } from "@/components/ui/button";

type CursorPaginationProps = {
  nextCursor?: number;
  canGoBack: boolean;
  onNext: () => void;
  onBack: () => void;
};

/**
 * Newer / older controls for cursor-paginated lists. Renders nothing when the
 * only page has neither a next cursor nor history.
 */
export function CursorPagination({
  nextCursor,
  canGoBack,
  onNext,
  onBack,
}: CursorPaginationProps) {
  if (!nextCursor && !canGoBack) return null;
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button
        variant="outline"
        className="h-9 text-xs"
        disabled={!canGoBack}
        onClick={onBack}
      >
        Newer
      </Button>
      <Button
        variant="outline"
        className="h-9 text-xs"
        disabled={!nextCursor}
        onClick={onNext}
      >
        Older
      </Button>
    </div>
  );
}
