import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionClient } from './evolution.client';

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
    return new EvolutionClient(config);
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
