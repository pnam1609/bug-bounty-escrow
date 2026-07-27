import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthenticatedRequest } from '../common/auth/authenticated-request.js';
import { IS_PUBLIC_ROUTE } from '../common/decorators/public.decorator.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';
import { AuthRepository } from './auth.repository.js';

function readBearerToken(authorization: unknown): string | undefined {
  if (typeof authorization !== 'string') {
    return undefined;
  }

  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);

  return match?.[1];
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request.headers.authorization);

    if (token === undefined) {
      if (isPublic) {
        return true;
      }

      throw new UnauthorizedException();
    }

    const { data, error } = await this.client.auth.getUser(token);

    if (error !== null || data.user === null || typeof data.user.email !== 'string') {
      throw new UnauthorizedException();
    }

    const profile = await this.repository.findProfile(data.user.id);

    if (profile === null) {
      throw new UnauthorizedException();
    }

    request.principal = {
      userId: data.user.id,
      email: data.user.email,
      role: profile.role,
    };

    return true;
  }
}
