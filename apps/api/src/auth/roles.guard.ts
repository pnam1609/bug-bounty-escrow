import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApplicationRole } from '@bug-bounty-escrow/shared';

import type { AuthenticatedRequest } from '../common/auth/authenticated-request.js';
import { REQUIRED_ROLES } from '../common/decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<readonly ApplicationRole[]>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;

    if (principal === undefined || !requiredRoles.includes(principal.role)) {
      throw new ForbiddenException();
    }

    return true;
  }
}
