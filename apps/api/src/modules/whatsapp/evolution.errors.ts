import {
  EVOLUTION_ERROR_CLASS,
  type EvolutionErrorClass,
} from './evolution.constants';

export class EvolutionChannelError extends Error {
  readonly errorClass: EvolutionErrorClass;
  readonly statusCode?: number;
  readonly operation: string;
  readonly retryable: boolean;
  /** Populated for HTTP 429 when Retry-After is present. */
  retryAfterMs?: number;

  constructor(input: {
    message: string;
    errorClass: EvolutionErrorClass;
    operation: string;
    statusCode?: number;
    retryable?: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = 'EvolutionChannelError';
    this.errorClass = input.errorClass;
    this.operation = input.operation;
    this.statusCode = input.statusCode;
    this.retryable = input.retryable ?? isRetryableClass(input.errorClass);
    this.retryAfterMs = input.retryAfterMs;
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }

  static circuitOpen(operation: string): EvolutionChannelError {
    return new EvolutionChannelError({
      message: 'Evolution circuit breaker is OPEN',
      errorClass: EVOLUTION_ERROR_CLASS.CIRCUIT_OPEN,
      operation,
      retryable: false,
    });
  }

  static connectCooldown(
    operation: string,
    retryAfterMs: number,
  ): EvolutionChannelError {
    return new EvolutionChannelError({
      message: `Evolution connect cooldown active (${retryAfterMs}ms)`,
      errorClass: EVOLUTION_ERROR_CLASS.CONNECT_COOLDOWN,
      operation,
      retryable: false,
    });
  }

  /** Stable audit / API error string. */
  toPublicMessage(): string {
    if (this.errorClass === EVOLUTION_ERROR_CLASS.TIMEOUT) {
      return EVOLUTION_ERROR_CLASS.UNCERTAIN_TIMEOUT;
    }
    return `${this.errorClass}: ${this.message}`.slice(0, 1000);
  }
}

export function isRetryableClass(errorClass: EvolutionErrorClass): boolean {
  return (
    errorClass === EVOLUTION_ERROR_CLASS.TIMEOUT ||
    errorClass === EVOLUTION_ERROR_CLASS.NETWORK ||
    errorClass === EVOLUTION_ERROR_CLASS.PROVIDER_5XX ||
    errorClass === EVOLUTION_ERROR_CLASS.RATE_LIMIT
  );
}

export function classifyHttpStatus(status: number): EvolutionErrorClass {
  if (status === 429) return EVOLUTION_ERROR_CLASS.RATE_LIMIT;
  if (status >= 500) return EVOLUTION_ERROR_CLASS.PROVIDER_5XX;
  if (status >= 400) return EVOLUTION_ERROR_CLASS.PROVIDER_4XX;
  return EVOLUTION_ERROR_CLASS.UNKNOWN;
}

export function classifyFetchFailure(err: unknown): EvolutionErrorClass {
  if (!err || typeof err !== 'object') return EVOLUTION_ERROR_CLASS.UNKNOWN;
  const name = 'name' in err ? String((err as { name?: unknown }).name) : '';
  const message =
    'message' in err ? String((err as { message?: unknown }).message) : '';
  if (name === 'AbortError' || /aborted|timeout/i.test(message)) {
    return EVOLUTION_ERROR_CLASS.TIMEOUT;
  }
  if (
    /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(
      message,
    )
  ) {
    return EVOLUTION_ERROR_CLASS.NETWORK;
  }
  return EVOLUTION_ERROR_CLASS.NETWORK;
}

export function isEvolutionChannelError(
  err: unknown,
): err is EvolutionChannelError {
  return err instanceof EvolutionChannelError;
}
