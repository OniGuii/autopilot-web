import { StructuredLogger } from './structured-logger';
import { runWithRequestContext } from './request-context';

describe('StructuredLogger', () => {
  const originalEnv = process.env.LOG_FORMAT;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalEnv;
  });

  it('emits JSON with correlation and tenant fields', () => {
    process.env.LOG_FORMAT = 'json';
    const logger = new StructuredLogger();
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    runWithRequestContext(
      {
        correlationId: 'corr-1',
        companyId: 'c1',
        userId: 'u1',
      },
      () => logger.log('hello world', 'AiService'),
    );

    expect(spy).toHaveBeenCalled();
    const line = String(spy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toEqual(
      expect.objectContaining({
        level: 'info',
        correlationId: 'corr-1',
        companyId: 'c1',
        userId: 'u1',
        module: 'AiService',
        message: 'hello world',
      }),
    );
    expect(typeof parsed.timestamp).toBe('string');
    spy.mockRestore();
  });
});
