import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { EvolutionCircuitBreaker } from './evolution.circuit-breaker';
import { EvolutionChannelMetrics } from './evolution.channel-metrics';
import {
  EVOLUTION_CB_FAILURE_THRESHOLD_DEFAULT,
  EVOLUTION_CB_HALF_OPEN_MAX_CALLS_DEFAULT,
  EVOLUTION_CB_OPEN_MS_DEFAULT,
  EVOLUTION_CB_SUCCESS_THRESHOLD_DEFAULT,
  EVOLUTION_CONNECT_COOLDOWN_MS_DEFAULT,
  EVOLUTION_ERROR_CLASS,
  EVOLUTION_RATE_LIMIT_WAIT_MAX_MS_DEFAULT,
  EVOLUTION_RETRY_BASE_MS_DEFAULT,
  EVOLUTION_RETRY_JITTER_MS_DEFAULT,
  EVOLUTION_RETRY_MAX_DEFAULT,
  EVOLUTION_RETRY_MAX_DELAY_MS_DEFAULT,
  EVOLUTION_TIMEOUT_CONNECT_MS_DEFAULT,
  EVOLUTION_TIMEOUT_DEFAULT_MS_DEFAULT,
  EVOLUTION_TIMEOUT_SEND_MS_DEFAULT,
  type CircuitState,
} from './evolution.constants';
import {
  EvolutionChannelError,
  classifyFetchFailure,
  classifyHttpStatus,
} from './evolution.errors';

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

type RequestOptions = {
  operation: string;
  timeoutMs: number;
  /** When true, apply retry/backoff for transient errors (never for sendText). */
  retryable: boolean;
  /** When false, skip circuit breaker gate (unused today; reserved). */
  useCircuit?: boolean;
};

/**
 * Evolution API adapter — Fase 6B Channel Hardening.
 * Stub mode (empty EVOLUTION_API_URL) is allowed only in development/test (P0).
 */
@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);
  private readonly apiUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly publicApiUrl: string;
  private readonly nodeEnv: string;

  private readonly timeoutSendMs: number;
  private readonly timeoutConnectMs: number;
  private readonly timeoutDefaultMs: number;
  private readonly retryMax: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly retryJitterMs: number;
  private readonly rateLimitWaitMaxMs: number;
  private readonly connectCooldownMs: number;
  private readonly cbEnabled: boolean;

  private readonly circuit: EvolutionCircuitBreaker;
  private readonly connectLastAt = new Map<string, number>();

  constructor(
    config: ConfigService,
    private readonly metrics: EvolutionChannelMetrics,
  ) {
    this.apiUrl = config.get<string>('evolution.apiUrl') || undefined;
    this.apiKey = config.get<string>('evolution.apiKey') || undefined;
    this.publicApiUrl = config.get<string>(
      'apiPublicUrl',
      'http://localhost:3001',
    );
    this.nodeEnv = config.get<string>('nodeEnv', 'development');

    this.timeoutSendMs = config.get<number>(
      'evolution.timeoutSendMs',
      EVOLUTION_TIMEOUT_SEND_MS_DEFAULT,
    );
    this.timeoutConnectMs = config.get<number>(
      'evolution.timeoutConnectMs',
      EVOLUTION_TIMEOUT_CONNECT_MS_DEFAULT,
    );
    this.timeoutDefaultMs = config.get<number>(
      'evolution.timeoutDefaultMs',
      EVOLUTION_TIMEOUT_DEFAULT_MS_DEFAULT,
    );
    this.retryMax = config.get<number>(
      'evolution.retryMax',
      EVOLUTION_RETRY_MAX_DEFAULT,
    );
    this.retryBaseMs = config.get<number>(
      'evolution.retryBaseMs',
      EVOLUTION_RETRY_BASE_MS_DEFAULT,
    );
    this.retryMaxDelayMs = config.get<number>(
      'evolution.retryMaxDelayMs',
      EVOLUTION_RETRY_MAX_DELAY_MS_DEFAULT,
    );
    this.retryJitterMs = config.get<number>(
      'evolution.retryJitterMs',
      EVOLUTION_RETRY_JITTER_MS_DEFAULT,
    );
    this.rateLimitWaitMaxMs = config.get<number>(
      'evolution.rateLimitWaitMaxMs',
      EVOLUTION_RATE_LIMIT_WAIT_MAX_MS_DEFAULT,
    );
    this.connectCooldownMs = config.get<number>(
      'evolution.connectCooldownMs',
      EVOLUTION_CONNECT_COOLDOWN_MS_DEFAULT,
    );
    this.cbEnabled = config.get<boolean>('evolution.circuitBreakerEnabled', true);

    this.circuit = new EvolutionCircuitBreaker({
      failureThreshold: config.get<number>(
        'evolution.cbFailureThreshold',
        EVOLUTION_CB_FAILURE_THRESHOLD_DEFAULT,
      ),
      successThreshold: config.get<number>(
        'evolution.cbSuccessThreshold',
        EVOLUTION_CB_SUCCESS_THRESHOLD_DEFAULT,
      ),
      openMs: config.get<number>(
        'evolution.cbOpenMs',
        EVOLUTION_CB_OPEN_MS_DEFAULT,
      ),
      halfOpenMaxCalls: config.get<number>(
        'evolution.cbHalfOpenMaxCalls',
        EVOLUTION_CB_HALF_OPEN_MAX_CALLS_DEFAULT,
      ),
    });
  }

  isStubMode(): boolean {
    return !this.apiUrl;
  }

  getCircuitState(): CircuitState {
    if (this.isStubMode() || !this.cbEnabled) return 'CLOSED';
    return this.circuit.getState();
  }

  getCircuitSnapshot() {
    return this.circuit.snapshot();
  }

  getMetricsSnapshot() {
    return this.metrics.snapshot({ circuitState: this.getCircuitState() });
  }

  /**
   * Peek circuit without consuming HALF_OPEN probe slot.
   * Use before creating PENDING / claiming EXECUTING (CH5/CH6).
   */
  assertAvailable(): void {
    if (this.isStubMode() || !this.cbEnabled) return;
    const state = this.circuit.getState();
    this.metrics.setCircuitState(state);
    if (state === 'OPEN') {
      throw new ServiceUnavailableException({
        message: 'CHANNEL_UNAVAILABLE',
        errorClass: EVOLUTION_ERROR_CLASS.CIRCUIT_OPEN,
        circuitState: state,
      });
    }
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

    this.assertConnectCooldown(input.instanceName);
    this.connectLastAt.set(input.instanceName, Date.now());

    // Budget: individual hops use connect timeout (retryable).
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
    await this.request('DELETE', `/instance/logout/${instanceName}`, undefined, {
      operation: 'logout',
      timeoutMs: this.timeoutDefaultMs,
      retryable: false,
    });
  }

  /**
   * Send plain text via Evolution (or stub id when URL empty in dev/test).
   * CH2: never auto-retries sendText.
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
      {
        operation: 'sendText',
        timeoutMs: this.timeoutSendMs,
        retryable: false,
      },
    );

    const externalMessageId = this.extractSentMessageId(data);
    if (!externalMessageId) {
      throw new EvolutionChannelError({
        message: 'Evolution sendText response missing message id',
        errorClass: EVOLUTION_ERROR_CLASS.UNKNOWN,
        operation: 'sendText',
        retryable: false,
      });
    }

    return {
      stub: false,
      externalMessageId,
      raw: data,
    };
  }

  /** Test helper — force circuit open. */
  forceCircuitOpen(): void {
    this.circuit.forceOpen();
    this.metrics.setCircuitState('OPEN');
  }

  forceCircuitClosed(): void {
    this.circuit.forceClosed();
    this.metrics.setCircuitState('CLOSED');
  }

  private assertConnectCooldown(instanceName: string): void {
    const last = this.connectLastAt.get(instanceName);
    if (last === undefined) return;
    const elapsed = Date.now() - last;
    if (elapsed < this.connectCooldownMs) {
      throw new ServiceUnavailableException({
        message: 'CHANNEL_CONNECT_COOLDOWN',
        errorClass: EVOLUTION_ERROR_CLASS.CONNECT_COOLDOWN,
        retryAfterMs: this.connectCooldownMs - elapsed,
      });
    }
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
      await this.request(
        'POST',
        '/instance/create',
        {
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        },
        {
          operation: 'createInstance',
          timeoutMs: this.timeoutConnectMs,
          retryable: true,
        },
      );
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
    await this.request(
      'POST',
      `/webhook/set/${instanceName}`,
      {
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
      },
      {
        operation: 'setWebhook',
        timeoutMs: this.timeoutConnectMs,
        retryable: true,
      },
    );
  }

  private async fetchQr(instanceName: string): Promise<string | null> {
    const data = await this.request<{
      base64?: string;
      qrcode?: { base64?: string };
    }>('GET', `/instance/connect/${instanceName}`, undefined, {
      operation: 'fetchQr',
      timeoutMs: this.timeoutConnectMs,
      retryable: true,
    });

    return data?.base64 ?? data?.qrcode?.base64 ?? null;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body: unknown | undefined,
    opts: RequestOptions,
  ): Promise<T> {
    const maxAttempts = opts.retryable ? this.retryMax + 1 : 1;
    let lastError: EvolutionChannelError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        this.metrics.recordRetry();
        const delay = this.backoffDelay(attempt - 1, lastError);
        await sleep(delay);
      }

      try {
        return await this.requestOnce<T>(method, path, body, opts);
      } catch (err) {
        const channelErr =
          err instanceof EvolutionChannelError
            ? err
            : new EvolutionChannelError({
                message: err instanceof Error ? err.message : String(err),
                errorClass: EVOLUTION_ERROR_CLASS.UNKNOWN,
                operation: opts.operation,
              });
        lastError = channelErr;

        const canRetry =
          opts.retryable &&
          attempt < maxAttempts &&
          channelErr.retryable &&
          channelErr.errorClass !== EVOLUTION_ERROR_CLASS.CIRCUIT_OPEN;

        if (!canRetry) throw channelErr;
      }
    }

    throw lastError ?? new Error('Evolution request failed');
  }

  private async requestOnce<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    opts: RequestOptions,
  ): Promise<T> {
    if (this.cbEnabled && !this.circuit.allowRequest()) {
      this.metrics.setCircuitState(this.circuit.getState());
      this.metrics.recordRequest('circuit_open', 0, EVOLUTION_ERROR_CLASS.CIRCUIT_OPEN);
      throw EvolutionChannelError.circuitOpen(opts.operation);
    }

    const url = `${this.apiUrl!.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey ?? '',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const durationMs = Date.now() - started;

      if (!response.ok) {
        const text = await response.text();
        const errorClass = classifyHttpStatus(response.status);
        const err = new EvolutionChannelError({
          message: `Evolution ${method} ${path} → ${response.status}: ${text}`.slice(
            0,
            500,
          ),
          errorClass,
          operation: opts.operation,
          statusCode: response.status,
          retryable: isRetryableHttp(response.status),
        });

        this.onRequestFailure(err, durationMs);
        // Attach Retry-After for 429
        if (response.status === 429) {
          const ra = response.headers.get('retry-after');
          if (ra) {
            const seconds = Number(ra);
            if (Number.isFinite(seconds)) {
              err.retryAfterMs = Math.min(
                seconds * 1000,
                this.rateLimitWaitMaxMs,
              );
            }
          }
        }
        throw err;
      }

      this.onRequestSuccess(durationMs);

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof EvolutionChannelError) throw err;

      const durationMs = Date.now() - started;
      const errorClass = classifyFetchFailure(err);
      const channelErr = new EvolutionChannelError({
        message:
          errorClass === EVOLUTION_ERROR_CLASS.TIMEOUT
            ? `Evolution ${opts.operation} timed out after ${opts.timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err),
        errorClass,
        operation: opts.operation,
        cause: err,
      });
      this.onRequestFailure(channelErr, durationMs);
      throw channelErr;
    } finally {
      clearTimeout(timer);
    }
  }

  private onRequestSuccess(durationMs: number): void {
    this.circuit.recordSuccess();
    this.metrics.setCircuitState(this.circuit.getState());
    this.metrics.recordRequest('ok', durationMs);
    this.logger.debug?.(`Evolution ok durationMs=${durationMs}`);
  }

  private onRequestFailure(
    err: EvolutionChannelError,
    durationMs: number,
  ): void {
    if (countsTowardCircuit(err.errorClass)) {
      this.circuit.recordFailure();
    } else {
      this.circuit.releaseHalfOpenSlot();
    }
    this.metrics.setCircuitState(this.circuit.getState());
    this.metrics.recordRequest(
      err.errorClass.toLowerCase(),
      durationMs,
      err.errorClass,
    );
    this.logger.warn(
      `Evolution ${err.operation} failed class=${err.errorClass} durationMs=${durationMs} msg=${err.message}`,
    );
  }

  private backoffDelay(
    attempt: number,
    lastError?: EvolutionChannelError,
  ): number {
    if (
      lastError?.errorClass === EVOLUTION_ERROR_CLASS.RATE_LIMIT &&
      lastError.retryAfterMs
    ) {
      return lastError.retryAfterMs;
    }
    const exp = Math.min(
      this.retryMaxDelayMs,
      this.retryBaseMs * 2 ** (attempt - 1),
    );
    const jitter = Math.floor(Math.random() * (this.retryJitterMs + 1));
    return exp + jitter;
  }
}

function isRetryableHttp(status: number): boolean {
  return status === 429 || status >= 500;
}

function countsTowardCircuit(errorClass: string): boolean {
  return (
    errorClass === EVOLUTION_ERROR_CLASS.TIMEOUT ||
    errorClass === EVOLUTION_ERROR_CLASS.NETWORK ||
    errorClass === EVOLUTION_ERROR_CLASS.PROVIDER_5XX ||
    errorClass === EVOLUTION_ERROR_CLASS.RATE_LIMIT
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
