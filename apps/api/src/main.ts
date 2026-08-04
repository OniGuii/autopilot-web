import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import {
  shutdownOpenTelemetry,
  startOpenTelemetry,
} from './observability/otel.bootstrap';
import { StructuredLogger } from './observability/structured-logger';

async function bootstrap() {
  startOpenTelemetry();

  const app = await NestFactory.create(AppModule, {
    logger: new StructuredLogger(),
  });
  app.enableShutdownHooks();
  const configService = app.get(ConfigService);

  const port = configService.get<number>('port', 3001);
  const apiPrefix = configService.get<string>('apiPrefix', 'api');
  const nodeEnv = configService.get<string>('nodeEnv', 'development');
  const swaggerEnabled = configService.get<boolean>('swaggerEnabled', false);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix(apiPrefix, {
    exclude: ['health', 'health/live', 'health/ready', 'metrics'],
  });

  if (swaggerEnabled) {
    const swaggerUser = configService.get<string>('swaggerUser');
    const swaggerPassword = configService.get<string>('swaggerPassword');

    if (nodeEnv === 'production') {
      if (!swaggerUser || !swaggerPassword) {
        throw new Error(
          'SWAGGER_USER and SWAGGER_PASSWORD are required when Swagger is enabled in production',
        );
      }
      app.use(
        ['/docs', '/docs-json'],
        swaggerBasicAuth(swaggerUser, swaggerPassword),
      );
    } else if (swaggerUser && swaggerPassword) {
      app.use(
        ['/docs', '/docs-json'],
        swaggerBasicAuth(swaggerUser, swaggerPassword),
      );
    }

    const swaggerConfig = new DocumentBuilder()
      .setTitle('AutoPilot API')
      .setDescription('Plataforma de recuperação e conversão de leads com IA.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  process.once('beforeExit', () => {
    void shutdownOpenTelemetry();
  });

  await app.listen(port);

  const logger = app.get(StructuredLogger);
  logger.log(
    `AutoPilot API listening on http://localhost:${port}`,
    'Bootstrap',
  );
  if (swaggerEnabled) {
    logger.log(`Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
  }
}

function swaggerBasicAuth(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const u = sep >= 0 ? decoded.slice(0, sep) : '';
      const p = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (u === user && p === password) {
        next();
        return;
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="AutoPilot API Docs"');
    res.status(401).send('Authentication required');
  };
}

void bootstrap();
