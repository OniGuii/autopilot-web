import * as Joi from 'joi';

/** Known insecure default — rejected outside test. */
export const JWT_DEV_FALLBACK_SECRET = 'dev-only-access-secret-change-me';

export const JWT_TEST_DEFAULT_SECRET = 'test-only-jwt-access-secret-32b';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3001),
  API_PREFIX: Joi.string().default('api'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').optional(),
  SWAGGER_USER: Joi.string().allow('').optional(),
  SWAGGER_PASSWORD: Joi.string().allow('').optional(),

  THROTTLE_TTL_MS: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(120),
  THROTTLE_AUTH_LIMIT: Joi.number().default(20),

  DATABASE_URL: Joi.string().min(1).required(),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  OPENAI_API_KEY: Joi.string().allow('').optional(),
  OPENAI_MODEL: Joi.string().allow('').optional(),

  EVOLUTION_API_URL: Joi.string().allow('').optional(),
  EVOLUTION_API_KEY: Joi.string().allow('').optional(),
  EVOLUTION_INSTANCE: Joi.string().allow('').optional(),
  EVOLUTION_TIMEOUT_SEND_MS: Joi.number().integer().min(1000).default(15_000),
  EVOLUTION_TIMEOUT_CONNECT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(20_000),
  EVOLUTION_TIMEOUT_DEFAULT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(10_000),
  EVOLUTION_RETRY_MAX: Joi.number().integer().min(0).default(2),
  EVOLUTION_RETRY_BASE_MS: Joi.number().integer().min(0).default(200),
  EVOLUTION_RETRY_MAX_DELAY_MS: Joi.number().integer().min(0).default(2_000),
  EVOLUTION_RETRY_JITTER_MS: Joi.number().integer().min(0).default(200),
  EVOLUTION_RATE_LIMIT_WAIT_MAX_MS: Joi.number()
    .integer()
    .min(0)
    .default(5_000),
  EVOLUTION_CONNECT_COOLDOWN_MS: Joi.number().integer().min(0).default(10_000),
  EVOLUTION_CB_ENABLED: Joi.string().valid('true', 'false').default('true'),
  EVOLUTION_CB_FAILURE_THRESHOLD: Joi.number().integer().min(1).default(5),
  EVOLUTION_CB_SUCCESS_THRESHOLD: Joi.number().integer().min(1).default(2),
  EVOLUTION_CB_OPEN_MS: Joi.number().integer().min(1000).default(30_000),
  EVOLUTION_CB_HALF_OPEN_MAX_CALLS: Joi.number().integer().min(1).default(1),
  WEBHOOK_SLOW_MS: Joi.number().integer().min(100).default(2_000),
  WEBHOOK_MAX_INFLIGHT: Joi.number().integer().min(1).default(50),
  OPS_RECONCILE_TAKE: Joi.number().integer().min(1).default(100),
  API_PUBLIC_URL: Joi.string()
    .uri({ allowRelative: false })
    .allow('')
    .optional(),

  /**
   * P0: obrigatório fora de test. Em test, default seguro para CI/Jest.
   * Nunca aceita o fallback histórico de desenvolvimento.
   */
  JWT_ACCESS_SECRET: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string().min(16).default(JWT_TEST_DEFAULT_SECRET),
    otherwise: Joi.string()
      .min(32)
      .invalid(JWT_DEV_FALLBACK_SECRET)
      .required()
      .messages({
        'any.required':
          'JWT_ACCESS_SECRET is required when NODE_ENV is not test',
        'any.invalid':
          'JWT_ACCESS_SECRET must not use the insecure development default',
        'string.min': 'JWT_ACCESS_SECRET must be at least 32 characters',
      }),
  }),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: Joi.number().default(7),

  AUTH_MAX_SESSIONS_PER_USER: Joi.number().integer().min(1).default(5),
  AUTH_MEMBERSHIP_CACHE_TTL_SECONDS: Joi.number().integer().min(1).default(30),

  ASYNC_INBOUND_ENABLED: Joi.string().valid('true', 'false').default('false'),
  ASYNC_WORKERS_IN_API: Joi.string().valid('true', 'false').default('true'),
  ASYNC_INBOUND_ATTEMPTS: Joi.number().integer().min(1).default(5),
  ASYNC_INBOUND_BACKOFF_MS: Joi.number().integer().min(100).default(2_000),
  /** @deprecated prefer QUEUE_CONCURRENCY */
  ASYNC_INBOUND_CONCURRENCY: Joi.number().integer().min(1).optional(),

  /** 7.1-H — fail-fast queue retention / concurrency */
  QUEUE_CONCURRENCY: Joi.number().integer().min(1).default(10),
  QUEUE_REMOVE_ON_COMPLETE: Joi.number().integer().min(0).default(1_000),
  QUEUE_REMOVE_ON_FAIL: Joi.number().integer().min(0).default(5_000),
  QUEUE_DLQ_MAX_JOBS: Joi.number().integer().min(1).default(1_000),
  QUEUE_DLQ_RETENTION_MS: Joi.number()
    .integer()
    .min(60_000)
    .default(7 * 24 * 60 * 60 * 1000),
  QUEUE_DLQ_STALE_MS: Joi.number()
    .integer()
    .min(60_000)
    .default(60 * 60 * 1000),
  WEBHOOK_CLAIM_STALE_MS: Joi.number().integer().min(1_000).default(45_000),
  WEBHOOK_RECEIVED_STALE_MS: Joi.number()
    .integer()
    .min(60_000)
    .default(5 * 60 * 1000),

  /** 7.2A — FollowUp scheduler (default off = manual execute only). */
  ASYNC_FOLLOWUP_ENABLED: Joi.string().valid('true', 'false').default('false'),
  FOLLOWUP_SCHEDULER_ATTEMPTS: Joi.number().integer().min(1).default(3),
  FOLLOWUP_SCHEDULER_BACKOFF_MS: Joi.number().integer().min(100).default(5_000),
  FOLLOWUP_SCHEDULER_CONCURRENCY: Joi.number().integer().min(1).default(5),
  FOLLOWUP_SCHEDULER_SCAN_INTERVAL_MS: Joi.number()
    .integer()
    .min(5_000)
    .default(30_000),
  FOLLOWUP_SCHEDULER_SCAN_BATCH: Joi.number().integer().min(1).default(50),
  FOLLOWUP_SCHEDULER_BACKLOG_HIGH: Joi.number().integer().min(1).default(100),
});
