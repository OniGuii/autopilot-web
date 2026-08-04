import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { OBS_SERVICE_NAME_DEFAULT } from './observability.constants';
import { getRequestContext } from './request-context';

type StructuredLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * JSON structured logger (8A).
 * Fields: timestamp, level, service, correlationId, companyId, userId, module, message.
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly serviceName: string;
  private readonly json: boolean;

  constructor() {
    this.serviceName =
      process.env.OTEL_SERVICE_NAME?.trim() || OBS_SERVICE_NAME_DEFAULT;
    const format = (process.env.LOG_FORMAT ?? '').toLowerCase();
    if (format === 'json') {
      this.json = true;
    } else if (format === 'pretty') {
      this.json = false;
    } else {
      this.json = (process.env.NODE_ENV ?? 'development') === 'production';
    }
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug?(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose?(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  fatal?(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  setLogLevels?(_levels: LogLevel[]): void {
    void _levels;
  }

  private write(
    level: StructuredLevel,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const ctx = getRequestContext();
    const moduleName =
      this.extractContext(optionalParams) ?? ctx.module ?? undefined;
    const text = this.formatMessage(message, optionalParams, moduleName);

    if (!this.json) {
      const prefix = moduleName ? `[${moduleName}] ` : '';
      const line = `${prefix}${text}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
      return;
    }

    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      correlationId: ctx.correlationId ?? null,
      companyId: ctx.companyId ?? null,
      userId: ctx.userId ?? null,
      module: moduleName ?? null,
      message: text,
    };

    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  private extractContext(optionalParams: unknown[]): string | undefined {
    if (optionalParams.length === 0) return undefined;
    const last = optionalParams[optionalParams.length - 1];
    return typeof last === 'string' ? last : undefined;
  }

  private formatMessage(
    message: unknown,
    optionalParams: unknown[],
    moduleName?: string,
  ): string {
    const parts = [message, ...optionalParams];
    // Nest passes context as last string arg — strip when already used as module.
    if (moduleName && parts.length > 1) {
      const last = parts[parts.length - 1];
      if (last === moduleName) parts.pop();
    }
    return parts
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p instanceof Error) return p.stack ?? p.message;
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .filter((s) => s.length > 0)
      .join(' ');
  }
}
