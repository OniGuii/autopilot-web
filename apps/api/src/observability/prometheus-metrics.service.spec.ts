import { ConfigService } from '@nestjs/config';
import { PrometheusMetricsService } from './prometheus-metrics.service';

describe('PrometheusMetricsService', () => {
  it('renders prometheus text with http and ai series', async () => {
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'observability.metricsEnabled') return true;
        if (key === 'observability.serviceName') return 'autopilot-api-test';
        return def;
      }),
    } as unknown as ConfigService;

    const service = new PrometheusMetricsService(config);
    service.recordHttp({
      method: 'GET',
      route: '/api/ops/metrics',
      statusCode: 200,
      durationMs: 12,
    });
    service.recordAiSuccess(100, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    service.recordWhatsappSend(true);
    service.recordPrismaQuery('Message', 'findMany', 8);

    const body = await service.render();
    expect(body).toContain('http_requests_total');
    expect(body).toContain('ai_suggestions_generated_total');
    expect(body).toContain('ai_tokens_total');
    expect(body).toContain('whatsapp_sends_total');
    expect(body).toContain('prisma_query_duration_seconds');
  });
});
