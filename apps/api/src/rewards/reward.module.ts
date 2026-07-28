import { Module } from '@nestjs/common';

import { RewardController } from './reward.controller.js';
import { RewardRepository } from './reward.repository.js';
import { RewardService } from './reward.service.js';

@Module({
  controllers: [RewardController],
  providers: [RewardRepository, RewardService],
  exports: [RewardRepository, RewardService],
})
export class RewardModule {}
