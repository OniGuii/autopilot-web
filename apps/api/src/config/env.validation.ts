import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3001),
  API_PREFIX: Joi.string().default('api'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('true'),

  DATABASE_URL: Joi.string().min(1).required(),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  OPENAI_API_KEY: Joi.string().allow('').optional(),
  OPENAI_MODEL: Joi.string().allow('').optional(),

  EVOLUTION_API_URL: Joi.string().allow('').optional(),
  EVOLUTION_API_KEY: Joi.string().allow('').optional(),
  EVOLUTION_INSTANCE: Joi.string().allow('').optional(),

  JWT_ACCESS_SECRET: Joi.string().min(16).optional(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: Joi.number().default(7),
});
