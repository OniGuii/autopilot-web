import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionChannelMetrics } from './evolution.channel-metrics';
import { EvolutionClient } from './evolution.client';
import { EVOLUTION_ERROR_CLASS } from './evolution.constants';
import { EvolutionChannelError } from './evolution.errors';

describe('EvolutionClient stub policy (P0)', () => {
  function build(nodeEnv: string, apiUrl?: string) {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'evolution.apiUrl') return apiUrl;
        if (key === 'evolution.apiKey') return undefined;
        if (key === 'apiPublicUrl') return 'http://localhost:3001';
        if (key === 'nodeEnv') return nodeEnv;
        return fallback;
      }),
    } as unknown as ConfigService;
    return new EvolutionClient(config, new EvolutionChannelMetrics());
  }

  it('permite stub em development sem EVOLUTION_API_URL', async () => {
    const client = build('development');
    const result = await client.ensureInstanceAndQr({
      instanceName: 'x',
      instanceKey: 'k',
      webhookSecretPlain: 's',
    });
    expect(result.stub).toBe(true);
  });

  it('permite stub em test sem EVOLUTION_API_URL', async () => {
    const client = build('test');
    const result = await client.sendText({
      instanceName: 'x',
      phone: '+5511999999999',
      text: 'oi',
    });
    expect(result.stub).toBe(true);
    expect(result.externalMessageId).toMatch(/^stub-out:/);
  });

  it('proíbe stub em production sem EVOLUTION_API_URL', async () => {
    const client = build('production');
    await expect(
      client.ensureInstanceAndQr({
        instanceName: 'x',
        instanceKey: 'k',
        webhookSecretPlain: 's',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    await expect(
      client.sendText({
        instanceName: 'x',
        phone: '+5511999999999',
        text: 'oi',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('EvolutionClient channel hardening (6B)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  function buildLive(overrides?: Record<string, unknown>) {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const map: Record<string, unknown> = {
          'evolution.apiUrl': 'https://evo.test',
          'evolution.apiKey': 'key',
          apiPublicUrl: 'http://localhost:3001',
          nodeEnv: 'test',
          'evolution.timeoutSendMs': 50,
          'evolution.cbFailureThreshold': 2,
          'evolution.cbOpenMs': 60_000,
          'evolution.circuitBreakerEnabled': true,
          'evolution.retryMax': 1,
          'evolution.retryBaseMs': 1,
          'evolution.retryMaxDelayMs': 1,
          'evolution.retryJitterMs': 0,
          ...(overrides ?? {}),
        };
        return map[key] ?? fallback;
      }),
    } as unknown as ConfigService;
    return new EvolutionClient(config, new EvolutionChannelMetrics());
  }

  it('aborts sendText on timeout (AbortSignal)', async () => {
    global.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          });
        }),
    ) as unknown as typeof fetch;

    const client = buildLive();
    await expect(
      client.sendText({
        instanceName: 'x',
        phone: '5511999999999',
        text: 'oi',
      }),
    ).rejects.toMatchObject({
      errorClass: EVOLUTION_ERROR_CLASS.TIMEOUT,
    });
  });

  it('opens circuit after consecutive failures and assertAvailable throws 503', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'down',
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const client = buildLive();
    await expect(
      client.sendText({
        instanceName: 'x',
        phone: '5511999999999',
        text: 'a',
      }),
    ).rejects.toBeInstanceOf(EvolutionChannelError);
    await expect(
      client.sendText({
        instanceName: 'x',
        phone: '5511999999999',
        text: 'b',
      }),
    ).rejects.toBeInstanceOf(EvolutionChannelError);

    expect(client.getCircuitState()).toBe('OPEN');
    expect(() => client.assertAvailable()).toThrow(ServiceUnavailableException);
  });

  it('does not retry sendText on 500', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'err',
      headers: { get: () => null },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = buildLive();
    await expect(
      client.sendText({
        instanceName: 'x',
        phone: '5511999999999',
        text: 'oi',
      }),
    ).rejects.toBeInstanceOf(EvolutionChannelError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
