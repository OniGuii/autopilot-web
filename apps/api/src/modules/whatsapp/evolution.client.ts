import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export type EvolutionConnectResult = {
  qrCode: string | null;
  evolutionInstanceId?: string | null;
  stub: boolean;
};

export type EvolutionSendResult = {
  externalMessageId: string;
  stub: boolean;
  raw?: unknown;
};

/**
 * Thin Evolution API adapter.
 * Stub mode (empty EVOLUTION_API_URL) is allowed only in development/test (P0).
 */
@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);
  private readonly apiUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly publicApiUrl: string;
  private readonly nodeEnv: string;

  constructor(config: ConfigService) {
    this.apiUrl = config.get<string>('evolution.apiUrl') || undefined;
    this.apiKey = config.get<string>('evolution.apiKey') || undefined;
    this.publicApiUrl = config.get<string>(
      'apiPublicUrl',
      'http://localhost:3001',
    );
    this.nodeEnv = config.get<string>('nodeEnv', 'development');
  }

  isStubMode(): boolean {
    return !this.apiUrl;
  }

  /** Stub is forbidden outside development/test. */
  assertStubAllowed(): void {
    if (
      this.isStubMode() &&
      this.nodeEnv !== 'development' &&
      this.nodeEnv !== 'test'
    ) {
      throw new ServiceUnavailableException(
        'Evolution API URL is required outside development/test',
      );
    }
  }

  async ensureInstanceAndQr(input: {
    instanceName: string;
    instanceKey: string;
    webhookSecretPlain: string;
  }): Promise<EvolutionConnectResult> {
    if (this.isStubMode()) {
      this.assertStubAllowed();
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
    await this.setWebhook(
      input.instanceName,
      input.instanceKey,
      input.webhookSecretPlain,
    );
    const qrCode = await this.fetchQr(input.instanceName);

    return {
      stub: false,
      evolutionInstanceId: null,
      qrCode,
    };
  }

  async logout(instanceName: string): Promise<void> {
    if (this.isStubMode()) {
      this.assertStubAllowed();
      return;
    }
    await this.request('DELETE', `/instance/logout/${instanceName}`);
  }

  /**
   * Send plain text via Evolution (or stub id when URL empty in dev/test).
   */
  async sendText(input: {
    instanceName: string;
    phone: string;
    text: string;
  }): Promise<EvolutionSendResult> {
    if (this.isStubMode()) {
      this.assertStubAllowed();
      this.logger.warn(
        `Evolution stub mode: fake send for ${input.instanceName} → ${input.phone}`,
      );
      return {
        stub: true,
        externalMessageId: `stub-out:${randomUUID()}`,
      };
    }

    const number = input.phone.replace(/\D/g, '');
    const data = await this.request<Record<string, unknown>>(
      'POST',
      `/message/sendText/${input.instanceName}`,
      {
        number,
        text: input.text,
      },
    );

    const externalMessageId = this.extractSentMessageId(data);
    if (!externalMessageId) {
      throw new Error('Evolution sendText response missing message id');
    }

    return {
      stub: false,
      externalMessageId,
      raw: data,
    };
  }

  private extractSentMessageId(data: Record<string, unknown>): string | null {
    const key = data.key as Record<string, unknown> | undefined;
    if (key && typeof key.id === 'string' && key.id.trim()) {
      return key.id.trim().slice(0, 191);
    }
    if (typeof data.keyId === 'string' && data.keyId.trim()) {
      return data.keyId.trim().slice(0, 191);
    }
    if (typeof data.messageId === 'string' && data.messageId.trim()) {
      return data.messageId.trim().slice(0, 191);
    }
    const nested = data.data as Record<string, unknown> | undefined;
    if (nested) {
      return this.extractSentMessageId(nested);
    }
    return null;
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
        events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
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
      throw new Error(
        `Evolution ${method} ${path} → ${response.status}: ${text}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
