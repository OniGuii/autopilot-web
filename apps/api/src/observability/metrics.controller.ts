import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrometheusMetricsService } from './prometheus-metrics.service';

/**
 * Prometheus scrape endpoint — outside /api prefix (like /health).
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: PrometheusMetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    if (!this.metrics.isEnabled()) {
      res.status(404).send('metrics disabled');
      return;
    }
    const body = await this.metrics.render();
    res.setHeader('Content-Type', this.metrics.contentType());
    res.status(200).send(body);
  }
}
