import { cn } from "@/lib/utils";

const BRAND_FILL = "#0F5C4C";
const BRAND_STROKE = "#E8F5F0";
const BRAND_ACCENT = "#7BC4A8";

type BrandMarkProps = {
  className?: string;
  /**
   * Intrinsic pixel size (HTML width/height).
   * Keeps the mark bounded even when Tailwind CSS fails to load.
   */
  size?: number;
};

/** Brand mark — intrinsic size + hard CSS caps; never uses currentColor for fills. */
export function BrandMark({ className, size = 32 }: BrandMarkProps) {
  const safeSize = Number.isFinite(size) && size > 0 ? Math.min(size, 64) : 32;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={safeSize}
      height={safeSize}
      data-brand-mark=""
      className={cn(
        "block h-8 w-8 max-h-full max-w-full shrink-0 overflow-hidden",
        className,
      )}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill={BRAND_FILL} />
      <path
        d="M8 22 L16 8 L24 22"
        fill="none"
        stroke={BRAND_STROKE}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 16.5 H20.5"
        fill="none"
        stroke={BRAND_ACCENT}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandLogo({
  className,
  subtitle,
  markSize = 32,
}: {
  className?: string;
  subtitle?: string;
  markSize?: number;
}) {
  return (
    <div
      data-brand-logo=""
      className={cn(
        "flex max-w-full items-center gap-2.5 overflow-hidden",
        className,
      )}
    >
      <BrandMark size={markSize} />
      <div className="min-w-0 flex-1 overflow-hidden leading-tight">
        <p className="truncate font-display text-xl tracking-tight text-foreground">
          Autopilot
        </p>
        {subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
