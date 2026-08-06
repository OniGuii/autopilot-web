import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-8 w-8 shrink-0", className)}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="currentColor" className="text-primary" />
      <path
        d="M8 22 L16 8 L24 22"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 16.5 H20.5"
        fill="none"
        stroke="#A8D9C4"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandLogo({
  className,
  subtitle,
}: {
  className?: string;
  subtitle?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <div className="min-w-0 leading-tight">
        <p className="font-display text-xl tracking-tight text-foreground">
          Autopilot
        </p>
        {subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
