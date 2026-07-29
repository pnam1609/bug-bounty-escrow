import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import {
  EnvironmentValidationError,
  parseApiEnvironment,
  type ApiEnvironment,
} from '@bug-bounty-escrow/shared';

import { AppModule } from './app.module.js';
import { createCorsOptions } from './config/cors.js';
import { AppLogger } from './logging/app-logger.service.js';
import { createOpenApiDocumentFor } from './openapi/openapi.js';

export const API_GLOBAL_PREFIX = 'api';

export interface CreatedApiApplication {
  readonly app: INestApplication;
  readonly config: ApiEnvironment;
}

export const API_DOCS_PATH = 'api/docs';

export function configureApiApplication(app: INestApplication, config: ApiEnvironment): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableCors(createCorsOptions(config));
  app.enableShutdownHooks();
}

/*
 * Serves Swagger UI, but never in production: the document enumerates every route including the
 * settlement endpoints, and an unauthenticated docs page is free reconnaissance. Local and staging
 * get the interactive page; production is expected to publish the checked-in `openapi.json`
 * through whatever it already uses for developer docs.
 *
 * Kept out of `configureApiApplication` on purpose — that runs for the OpenAPI generator too, and
 * mounting the UI inside the very call that builds the document is a needless circularity.
 */
export function mountApiDocumentation(app: INestApplication, config: ApiEnvironment): boolean {
  if (config.NODE_ENV === 'production') return false;

  SwaggerModule.setup(API_DOCS_PATH, app, createOpenApiDocumentFor(app), {
    // Otherwise a page refresh silently drops the token and every call comes back 401.
    swaggerOptions: { persistAuthorization: true },
  });

  return true;
}

export async function createApiApplication(
  environmentInput: Readonly<Record<string, unknown>>,
): Promise<CreatedApiApplication> {
  const config = parseApiEnvironment(environmentInput);
  const app = await NestFactory.create(AppModule.forRoot(config), {
    bufferLogs: true,
    rawBody: true,
  });
  const logger = app.get(AppLogger);

  app.useLogger(logger);
  app.flushLogs();
  configureApiApplication(app, config);

  return { app, config };
}

export async function bootstrap(
  environmentInput: Readonly<Record<string, unknown>>,
): Promise<INestApplication> {
  const { app, config } = await createApiApplication(environmentInput);
  const documentationMounted = mountApiDocumentation(app, config);

  await app.listen(config.PORT);

  if (documentationMounted) {
    app.get(AppLogger).info({ path: `/${API_DOCS_PATH}` }, 'API documentation available');
  }

  return app;
}

export function formatStartupError(error: unknown): string {
  if (error instanceof EnvironmentValidationError) {
    return error.message;
  }

  return 'API failed to start because of an unexpected error';
}
