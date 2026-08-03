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
});
