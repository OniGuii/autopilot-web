type PrismaMetricsRecorder = (
  model: string,
  operation: string,
  durationMs: number,
) => void;

let recorder: PrismaMetricsRecorder | null = null;

export function setPrismaMetricsRecorder(
  next: PrismaMetricsRecorder | null,
): void {
  recorder = next;
}

export function recordPrismaQueryMetric(
  model: string,
  operation: string,
  durationMs: number,
): void {
  try {
    recorder?.(model, operation, durationMs);
  } catch {
    // never break queries due to metrics
  }
}
