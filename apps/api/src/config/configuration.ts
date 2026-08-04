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
