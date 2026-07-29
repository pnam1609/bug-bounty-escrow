import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/*
 * Builds the OpenAPI document from a running application.
 *
 * Deliberately free of any import from `bootstrap`: `bootstrap` imports this module to serve the
 * docs page, and the two importing each other would be a cycle. Generating the checked-in
 * `openapi.json` needs a booted app, so that half lives in `openapi-snapshot.ts` instead.
 */

export const OPENAPI_OUTPUT_FILE = 'openapi.json';

/** Named so "Authorize" in Swagger UI and the `security` entries in the spec agree. */
export const OPENAPI_BEARER_SCHEME = 'supabaseAccessToken';

/*
 * One builder for both consumers: the checked-in `openapi.json` and the UI served by `bootstrap`.
 * If they each configured their own, the file the frontend generates clients from would drift from
 * the page people actually test against.
 */
function buildConfiguration() {
  return new DocumentBuilder()
    .setTitle('Bug Bounty Escrow API')
    .setDescription('Off-chain application API for the Bug Bounty Escrow MVP')
    .setVersion('1.0.0')
    .addServer('/api', 'Version-neutral API prefix')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Supabase access token. Sign in through GoTrue and paste the `access_token` here.',
      },
      OPENAPI_BEARER_SCHEME,
    )
    .build();
}

/** Decorations Nest cannot infer from the controllers. */
export function decorateOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  /*
   * Required globally rather than per controller. Everything except the four `@Public()` routes
   * needs a session, and those declare their own empty requirement, so stating it once here means
   * a new controller is documented as protected by default — the safe direction to be wrong in.
   */
  document.security = [{ [OPENAPI_BEARER_SCHEME]: [] }];

  document.components ??= {};
  document.components.headers = {
    ...document.components.headers,
    CorrelationId: {
      description: 'Safe request correlation identifier',
      schema: {
        type: 'string',
        maxLength: 128,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
      },
    },
  };
  document.components.schemas = {
    ...document.components.schemas,
    ApiErrorResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: {},
          },
        },
        correlationId: {
          type: 'string',
          maxLength: 128,
        },
      },
    },
  };

  /*
   * @nestjs/swagger currently omits Nest's HEAD routes from its route explorer.
   * Keep this explicit transformation next to the other non-inferable metadata:
   * the runtime route exists and Circle uses it to check webhook reachability.
   */
  const gatewayWebhookPath = (document.paths['/webhooks/circle/gateway'] ??= {});
  if (gatewayWebhookPath.post?.parameters !== undefined) {
    gatewayWebhookPath.post.parameters = [...gatewayWebhookPath.post.parameters].sort(
      (left, right) => {
        const leftName = 'name' in left ? left.name : left.$ref;
        const rightName = 'name' in right ? right.name : right.$ref;
        return leftName.localeCompare(rightName);
      },
    );
  }
  gatewayWebhookPath.head = {
    operationId: 'CircleGatewayWebhookController_readiness',
    summary: 'Check Circle Gateway webhook endpoint reachability',
    responses: {
      200: {
        description: 'Circle Gateway webhook endpoint is reachable',
      },
    },
    security: [{}],
    tags: ['CircleGatewayWebhook'],
  };

  return document;
}

export function createOpenApiDocumentFor(app: INestApplication): OpenAPIObject {
  return decorateOpenApiDocument(
    SwaggerModule.createDocument(app, buildConfiguration(), { ignoreGlobalPrefix: true }),
  );
}

function sortForDeterminism(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForDeterminism);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortForDeterminism(entry)]),
  );
}

export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(sortForDeterminism(document), null, 2)}\n`;
}
