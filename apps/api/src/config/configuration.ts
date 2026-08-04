export default () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  return {
    nodeEnv,
    port: parseInt(process.env.PORT ?? '3001', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    /**
     * Swagger: default off in production; explicit SWAGGER_ENABLED wins.
     */
    swaggerEnabled:
      process.env.SWAGGER_ENABLED !== undefined
        ? process.env.SWAGGER_ENABLED === 'true'
        : nodeEnv !== 'production',
    swaggerUser: process.env.SWAGGER_USER || undefined,
    swaggerPassword: process.env.SWAGGER_PASSWORD || undefined,
    database: {
      url: process.env.DATABASE_URL,
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    },
    evolution: {
      apiUrl: process.env.EVOLUTION_API_URL,
      apiKey: process.env.EVOLUTION_API_KEY,
      instance: process.env.EVOLUTION_INSTANCE,
      timeoutSendMs: parseInt(
        process.env.EVOLUTION_TIMEOUT_SEND_MS ?? '15000',
        10,
      ),
      timeoutConnectMs: parseInt(
        process.env.EVOLUTION_TIMEOUT_CONNECT_MS ?? '20000',
        10,
      ),
      timeoutDefaultMs: parseInt(
        process.env.EVOLUTION_TIMEOUT_DEFAULT_MS ?? '10000',
        10,
      ),
      retryMax: parseInt(process.env.EVOLUTION_RETRY_MAX ?? '2', 10),
      retryBaseMs: parseInt(process.env.EVOLUTION_RETRY_BASE_MS ?? '200', 10),
      retryMaxDelayMs: parseInt(
        process.env.EVOLUTION_RETRY_MAX_DELAY_MS ?? '2000',
        10,
      ),
      retryJitterMs: parseInt(
        process.env.EVOLUTION_RETRY_JITTER_MS ?? '200',
        10,
      ),
      rateLimitWaitMaxMs: parseInt(
        process.env.EVOLUTION_RATE_LIMIT_WAIT_MAX_MS ?? '5000',
        10,
      ),
      connectCooldownMs: parseInt(
        process.env.EVOLUTION_CONNECT_COOLDOWN_MS ?? '10000',
        10,
      ),
      circuitBreakerEnabled:
        (process.env.EVOLUTION_CB_ENABLED ?? 'true') === 'true',
      cbFailureThreshold: parseInt(
        process.env.EVOLUTION_CB_FAILURE_THRESHOLD ?? '5',
        10,
      ),
      cbSuccessThreshold: parseInt(
        process.env.EVOLUTION_CB_SUCCESS_THRESHOLD ?? '2',
        10,
      ),
      cbOpenMs: parseInt(process.env.EVOLUTION_CB_OPEN_MS ?? '30000', 10),
      cbHalfOpenMaxCalls: parseInt(
        process.env.EVOLUTION_CB_HALF_OPEN_MAX_CALLS ?? '1',
        10,
      ),
      webhookSlowMs: parseInt(process.env.WEBHOOK_SLOW_MS ?? '2000', 10),
      webhookMaxInflight: parseInt(
        process.env.WEBHOOK_MAX_INFLIGHT ?? '50',
        10,
      ),
    },
    ops: {
      reconcileTake: parseInt(process.env.OPS_RECONCILE_TAKE ?? '100', 10),
    },
    apiPublicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:3001',
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET,
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '7', 10),
    },
    auth: {
      maxSessionsPerUser: parseInt(
        process.env.AUTH_MAX_SESSIONS_PER_USER ?? '5',
        10,
      ),
      membershipCacheTtlSeconds: parseInt(
        process.env.AUTH_MEMBERSHIP_CACHE_TTL_SECONDS ?? '30',
        10,
      ),
    },
    throttle: {
      ttlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
      authLimit: parseInt(process.env.THROTTLE_AUTH_LIMIT ?? '20', 10),
    },
  };
};
