import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EvolutionConnectResult = {
  qrCode: string | null;
  evolutionInstanceId?: string | null;
  stub: boolean;
};

/**
 * Thin Evolution API adapter.
 * When EVOLUTION_API_URL is empty, operates in stub mode (local/dev/tests).
 */
@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);
  private readonly apiUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly publicApiUrl: string;

  constructor(config: ConfigService) {
    this.apiUrl = config.get<string>('evolution.apiUrl') || undefined;
    this.apiKey = config.get<string>('evolution.apiKey') || undefined;
    this.publicApiUrl = config.get<string>('apiPublicUrl', 'http://localhost:3001');
  }

  isStubMode(): boolean {
    return !this.apiUrl;
  }

  async ensureInstanceAndQr(input: {
    instanceName: string;
    instanceKey: string;
    webhookSecretPlain: string;
  }): Promise<EvolutionConnectResult> {
    if (this.isStubMode()) {
      this.logger.warn(
        `Evolution stub mode: fake QR for instance ${input.instanceName}`,
      );
      return {
        stub: true,
        evolutionInstanceId: null,
        qrCode: `stub-qr:${input.instanceKey}`,
      };
    }

    // Best-effort Evolution v2-style calls; failures surface as ERROR status upstream.
    await this.createInstance(input.instanceName);
    await this.setWebhook(input.instanceName, input.instanceKey, input.webhookSecretPlain);
    const qrCode = await this.fetchQr(input.instanceName);

    return {
      stub: false,
      evolutionInstanceId: null,
      qrCode,
    };
  }

  async logout(instanceName: string): Promise<void> {
    if (this.isStubMode()) return;
    await this.request('DELETE', `/instance/logout/${instanceName}`);
  }

  private webhookUrl(instanceKey: string): string {
    const base = this.publicApiUrl.replace(/\/$/, '');
    return `${base}/api/whatsapp/webhook/${instanceKey}`;
  }

  private async createInstance(instanceName: string): Promise<void> {
    try {
      await this.request('POST', '/instance/create', {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
    } catch (error) {
      // Instance may already exist — continue to QR/webhook setup.
      this.logger.warn(
        `Evolution createInstance: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async setWebhook(
    instanceName: string,
    instanceKey: string,
    webhookSecretPlain: string,
  ): Promise<void> {
    await this.request('POST', `/webhook/set/${instanceName}`, {
      webhook: {
        enabled: true,
        url: this.webhookUrl(instanceKey),
        headers: {
          'X-Webhook-Secret': webhookSecretPlain,
        },
        byEvents: false,
        base64: false,
        events: ['CONNECTION_UPDATE'],
      },
    });
  }

  private async fetchQr(instanceName: string): Promise<string | null> {
    const data = await this.request<{
      base64?: string;
      qrcode?: { base64?: string };
    }>('GET', `/instance/connect/${instanceName}`);

    return data?.base64 ?? data?.qrcode?.base64 ?? null;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl!.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey ?? '',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Evolution ${method} ${path} → ${response.status}: ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
