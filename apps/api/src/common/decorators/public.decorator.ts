import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

export const IS_PUBLIC_ROUTE = 'isPublicRoute';

/**
 * Marks a route as reachable without a session.
 *
 * It also writes the OpenAPI counterpart. The document requires the bearer scheme globally so the
 * "Authorize" button in Swagger UI applies everywhere; an empty requirement object here is the
 * standard way to say "this one is reachable without it", and keeping both on one decorator means
 * a route cannot be opened up in the guard while the published document still claims it is closed.
 */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC_ROUTE, true), ApiSecurity({}));
