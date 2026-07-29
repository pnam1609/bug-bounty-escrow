import type { Request } from 'express';

import {
  BadRequestException,
  Body,
  Controller,
  Head,
  Headers,
  HttpCode,
  Inject,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { circleGatewayDepositFinalizedWebhookSchema } from '@bug-bounty-escrow/shared';
import { z } from 'zod';

import { Public } from '../common/decorators/public.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { CircleGatewayWebhookVerifier } from './circle-gateway-webhook.verifier.js';
import { EscrowService } from './escrow.service.js';
import { GatewaySubscriptionLifecycleService } from './gateway-subscription-lifecycle.service.js';

const circleWebhookTestSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    notificationId: z.string().uuid(),
    notificationType: z.literal('webhooks.test'),
  })
  .passthrough();

@Public()
@Controller('webhooks/circle')
export class CircleGatewayWebhookController {
  public constructor(
    @Inject(CircleGatewayWebhookVerifier) private readonly verifier: CircleGatewayWebhookVerifier,
    @Inject(EscrowService) private readonly service: EscrowService,
    @Inject(GatewaySubscriptionLifecycleService)
    private readonly subscriptionLifecycle: GatewaySubscriptionLifecycleService,
  ) {}

  @Head('gateway')
  @HttpCode(200)
  public readiness(): void {}

  @Post('gateway')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiHeader({ name: 'x-circle-key-id', required: true })
  @ApiHeader({ name: 'x-circle-signature', required: true })
  public async gateway(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-circle-key-id') keyId?: string,
    @Headers('x-circle-signature') signature?: string,
  ): Promise<{ success: true }> {
    if (request.rawBody === undefined)
      throw new BadRequestException('circle_webhook_raw_body_missing');
    await this.verifier.verify(request.rawBody, keyId, signature);
    const test = circleWebhookTestSchema.safeParse(body);
    if (test.success) {
      await this.subscriptionLifecycle.recordSignedTest(
        test.data.subscriptionId,
        test.data.notificationId,
      );
      return { success: true };
    }
    const parsed = circleGatewayDepositFinalizedWebhookSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('circle_webhook_payload_invalid');
    await this.service.ingestGatewayDepositFinalized(parsed.data);
    return { success: true };
  }
}
