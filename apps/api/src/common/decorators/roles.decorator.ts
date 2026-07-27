import { SetMetadata } from '@nestjs/common';
import type { ApplicationRole } from '@bug-bounty-escrow/shared';

export const REQUIRED_ROLES = 'requiredRoles';
export const Roles = (...roles: ApplicationRole[]) => SetMetadata(REQUIRED_ROLES, roles);
