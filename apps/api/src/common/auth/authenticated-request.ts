import type { RequestPrincipal } from '@bug-bounty-escrow/shared';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  principal?: RequestPrincipal;
}
