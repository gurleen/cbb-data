import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pager({
  page,
  pages,
  total,
  size,
  onPage,
}: {
  page: number; // 1-based
  pages: number;
  total: number;
  size: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <nav
      aria-label="Pagination"
      className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="font-mono">
        {from}-{to} of {total}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto h-7 px-2"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <span className="font-mono">
        {page} / {pages}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </nav>
  );
}
