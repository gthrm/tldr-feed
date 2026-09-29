import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    // trustProxy: the only way in is the Cloudflare tunnel in front of Caddy.
    new FastifyAdapter({ trustProxy: true }),
  );

  // The subscribe form is plain HTML, so the body arrives urlencoded — the
  // Fastify adapter already parses that, registering formbody would collide.

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3090);
  await app.listen(port, '0.0.0.0');
}

await bootstrap();
