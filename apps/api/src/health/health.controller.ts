import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CORRELATION_ID_HEADER } from '@bug-bounty-escrow/shared';
import type { Response } from 'express';

import { ApiZodResponse } from '../openapi/zod-openapi.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  HealthService,
  notReadyHealthResponseSchema,
  readyHealthResponseSchema,
  type HealthResponse,
} from './health.service.js';

@ApiTags('platform')
@Public()
@Controller('health')
export class HealthController {
  // Explicit token: tsx/esbuild emits no `design:paramtypes`, so type-only injection silently
  // yields undefined under `pnpm dev`. See request-logging.middleware.ts.
  public constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @ApiOperation({
    summary: 'Check service and database readiness',
    operationId: 'getHealth',
  })
  @ApiHeader({
    name: CORRELATION_ID_HEADER,
    required: false,
    description: 'Optional safe correlation identifier',
  })
  @ApiZodResponse(HttpStatus.OK, 'Service is ready', readyHealthResponseSchema)
  @ApiZodResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    'Service is running but a dependency is not ready',
    notReadyHealthResponseSchema,
  )
  @Get()
  public async getHealth(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const health = await this.healthService.check();

    if (!health.ready) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return health;
  }
}
