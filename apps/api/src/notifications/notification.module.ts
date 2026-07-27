import { Module } from '@nestjs/common';

import { NotificationController } from './notification.controller.js';
import { NotificationRepository } from './notification.repository.js';

@Module({
  controllers: [NotificationController],
  providers: [NotificationRepository],
  exports: [NotificationRepository],
})
export class NotificationModule {}
