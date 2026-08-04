import { randomUUID } from 'crypto';
import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { OBS_CORRELATION_HEADER } from './observability.constants';
import { requestContextAls } from './request-context';

/**
 * Ensures every HTTP request has a correlationId (header or minted).
 * Propagates via AsyncLocalStorage + response header.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers[OBS_CORRELATION_HEADER];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const correlationId =
      typeof fromHeader === 'string' && fromHeader.trim().length > 0
        ? fromHeader.trim().slice(0, 128)
        : randomUUID();

    res.setHeader(OBS_CORRELATION_HEADER, correlationId);
    (req as Request & { correlationId?: string }).correlationId = correlationId;

    requestContextAls.run({ correlationId }, () => next());
  }
}
