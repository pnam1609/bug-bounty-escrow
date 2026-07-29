import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';

import type { AuthenticatedRequest } from '../common/auth/authenticated-request.js';
import { IS_PUBLIC_ROUTE } from '../common/decorators/public.decorator.js';
import { API_CONFIG } from '../config/api-config.module.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';
import { AuthRepository } from './auth.repository.js';

function readBearerToken(authorization: unknown): string | undefined {
  if (typeof authorization !== 'string') {
    return undefined;
  }

  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);

  return match?.[1];
}

const LOCAL_DEMO_USER_IDS = new Set([
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000006',
  '30000000-0000-4000-8000-000000000007',
]);

function isLocalDemoIdentity(user: { readonly id: string; readonly email?: string }): boolean {
  return (
    LOCAL_DEMO_USER_IDS.has(user.id) ||
    (typeof user.email === 'string' && user.email.toLowerCase().endsWith('@local.demo'))
  );
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(API_CONFIG)
    private readonly config: Pick<ApiEnvironment, 'NODE_ENV'>,
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

    if (error !== null || data.user === null) {
      throw new UnauthorizedException();
    }

    if (this.config.NODE_ENV === 'production' && isLocalDemoIdentity(data.user)) {
      throw new UnauthorizedException();
    }

    // Email/password and Google OAuth are the only supported product identities. Supabase's
    // generic User shape also permits phone-only accounts, so validate that product invariant
    // explicitly after the demo-ID check. This order ensures a deterministic demo UUID cannot
    // evade its production block merely because its Auth row has no email.
    if (typeof data.user.email !== 'string') {
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
