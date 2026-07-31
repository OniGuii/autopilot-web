import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const port = configService.get<number>('port', 3001);
  const apiPrefix = configService.get<string>('apiPrefix', 'api');
  const swaggerEnabled = configService.get<boolean>('swaggerEnabled', true);

  app.setGlobalPrefix(apiPrefix, {
    exclude: ['health', 'health/live', 'health/ready'],
  });

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AutoPilot API')
      .setDescription(
        'Plataforma de recuperação e conversão de leads com IA. Fundação arquitetural do MVP.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AutoPilot API listening on http://localhost:${port}`);
  if (swaggerEnabled) {
    // eslint-disable-next-line no-console
    console.log(`Swagger docs at http://localhost:${port}/docs`);
  }
}

void bootstrap();
