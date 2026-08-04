import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AsyncModule } from '../modules/async/async.module';
import { CorrelationMiddleware } from './correlation.middleware';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { StructuredLogger } from './structured-logger';

@Global()
@Module({
  imports: [AsyncModule],
  controllers: [MetricsController],
  providers: [
    StructuredLogger,
    PrometheusMetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [StructuredLogger, PrometheusMetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
