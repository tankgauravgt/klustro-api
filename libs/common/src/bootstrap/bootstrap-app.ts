import { NestFactory } from '@nestjs/core';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { type Type } from '@nestjs/common';
import { DocumentBuilder } from '@nestjs/swagger';
import { SwaggerModule } from '@nestjs/swagger';

// import services
import { applyTrustProxy } from './trust-proxy.js';
import { AppConfigService } from '../config/app-config.service.js';
import type { ConfigKey } from '../config/app-config.service.js';
import { publishAddress } from '../registry/service-registry.js';
import type { ServiceName } from '../registry/service-registry.js';

// The port written in a URL, or the scheme's default when the URL leaves it out
function portOf(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) {
    return Number(parsed.port);
  }
  return parsed.protocol === 'https:' ? 443 : 80;
}

export interface BootstrapOptions {
  title: string;
  description: string;
  // A URL from .env whose port the service listens on; without it the service takes an OS-assigned port
  listenAt?: ConfigKey;
  // Registers the service's address so the gateway and other services can find it
  publishAs?: ServiceName;
  // false leaves request bodies unread, so a proxy can forward them untouched
  bodyParser?: boolean;
  beforeListen?: (app: INestApplication) => void;
}

export async function bootstrapApp(
  rootModule: Type<unknown>,
  options: BootstrapOptions,
): Promise<void> {
  const app = await NestFactory.create(rootModule, {
    bodyParser: options.bodyParser ?? true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const config = app.get(AppConfigService);
  applyTrustProxy(app, config);
  app.enableCors({
    origin: config.get('WEB_URL'),
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  options.beforeListen?.(app);
  // Azure App Service sends traffic to the container port named in WEBSITES_PORT
  const websitesPort = config.optional('WEBSITES_PORT');
  const listenPort = websitesPort
    ? Number(websitesPort)
    : options.listenAt
      ? portOf(config.get(options.listenAt))
      : 0;
  await app.listen(listenPort);
  if (options.publishAs) {
    const { port } = app.getHttpServer().address() as AddressInfo;
    publishAddress(options.publishAs, `http://localhost:${port}`);
  }
}
