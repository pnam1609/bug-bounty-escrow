import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestPrincipal } from '@bug-bounty-escrow/shared';

import type { AuthenticatedRequest } from '../auth/authenticated-request.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestPrincipal | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);
