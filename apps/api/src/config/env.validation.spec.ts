import {
  JWT_DEV_FALLBACK_SECRET,
  JWT_TEST_DEFAULT_SECRET,
  envValidationSchema,
} from './env.validation';

describe('envValidationSchema JWT (P0)', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  };

  it('exige JWT_ACCESS_SECRET em development', () => {
    const { error } = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'development',
    });
    expect(error).toBeDefined();
  });

  it('rejeita fallback inseguro em development', () => {
    const { error } = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: JWT_DEV_FALLBACK_SECRET,
    });
    expect(error).toBeDefined();
  });

  it('aceita secret ≥32 chars em production', () => {
    const { error, value } = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'production-grade-secret-value-32b',
    });
    expect(error).toBeUndefined();
    expect(value.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('usa default de test quando NODE_ENV=test', () => {
    const { error, value } = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'test',
    });
    expect(error).toBeUndefined();
    expect(value.JWT_ACCESS_SECRET).toBe(JWT_TEST_DEFAULT_SECRET);
  });
});
