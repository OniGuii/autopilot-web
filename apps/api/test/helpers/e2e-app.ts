import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

export async function createE2eApp(): Promise<INestApplication<App>> {
  // Prefer Jest test env over .env NODE_ENV=development so OpenAI stub works
  // and fail-closed prod guards stay off during e2e.
  process.env.NODE_ENV = 'test';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/live', 'health/ready'],
  });
  await app.init();
  return app;
}

export const E2E_OWNER_EMAIL = 'owner@test.autopilot.dev';
export const E2E_PASSWORD = 'Demo@12345';
export const E2E_COMPANY_SLUG = 'test-fixture';
