import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

/** Route error boundary (spec §7.4): message + retry. */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-2xl">Something went wrong</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "The data for this page could not be loaded."}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => {
          reset();
          router.invalidate();
        }}
      >
        Retry
      </Button>
    </div>
  );
}
