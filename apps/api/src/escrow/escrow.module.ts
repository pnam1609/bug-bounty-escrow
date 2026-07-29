import { Module } from '@nestjs/common';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';

import { API_CONFIG } from '../config/api-config.module.js';
import { ArcRpcAdapter } from './arc-rpc.adapter.js';
import { CircleContractsAdapter } from './circle-contracts.adapter.js';
import { CircleGatewaySubscriptionClient } from './circle-gateway-subscription.client.js';
import { CircleGatewayWebhookController } from './circle-gateway-webhook.controller.js';
import { CircleGatewayWebhookVerifier } from './circle-gateway-webhook.verifier.js';
import { EscrowController } from './escrow.controller.js';
import { ARC_ESCROW_GATEWAY, CIRCLE_CONTRACTS_GATEWAY } from './escrow-gateways.js';
import { EscrowRepository } from './escrow.repository.js';
import { EscrowService } from './escrow.service.js';
import {
  GATEWAY_SUBSCRIPTION_REGISTRATION_STORE,
} from './gateway-subscription-registration.store.js';
import { GatewaySubscriptionLifecycleService } from './gateway-subscription-lifecycle.service.js';

@Module({
  controllers: [EscrowController, CircleGatewayWebhookController],
  providers: [
    EscrowRepository,
    EscrowService,
    CircleGatewayWebhookVerifier,
    CircleGatewaySubscriptionClient,
    GatewaySubscriptionLifecycleService,
    {
      provide: GATEWAY_SUBSCRIPTION_REGISTRATION_STORE,
      useExisting: EscrowRepository,
    },
    {
      provide: CIRCLE_CONTRACTS_GATEWAY,
      inject: [API_CONFIG],
      useFactory: (config: ApiEnvironment) => new CircleContractsAdapter(config),
    },
    {
      provide: ARC_ESCROW_GATEWAY,
      inject: [API_CONFIG],
      useFactory: (config: ApiEnvironment) => new ArcRpcAdapter(config),
    },
  ],
  exports: [EscrowService],
})
export class EscrowModule {}
