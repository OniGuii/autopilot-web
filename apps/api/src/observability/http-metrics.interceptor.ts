import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { PrometheusMetricsService } from './prometheus-metrics.service';

/**
 * Records HTTP request duration / error counters for Prometheus + Ops alerts.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: PrometheusMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const started = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const method = req.method ?? 'GET';
    const route =
      (req.route as { path?: string } | undefined)?.path ??
      req.path ??
      'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          this.metrics.recordHttp({
            method,
            route,
            statusCode: res.statusCode ?? 200,
            durationMs: Date.now() - started,
          });
        },
        error: (err: { status?: number; statusCode?: number }) => {
          const statusCode = err?.status ?? err?.statusCode ?? 500;
          this.metrics.recordHttp({
            method,
            route,
            statusCode,
            durationMs: Date.now() - started,
          });
        },
      }),
    );
  }
}
