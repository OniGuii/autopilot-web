import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingBlock({
  rows = 3,
  className,
  label = "Carregando…",
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-live="polite">
      <p className="sr-only">{label}</p>
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
