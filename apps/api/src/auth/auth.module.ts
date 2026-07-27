import { Module } from '@nestjs/common';

import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { MeController } from './me.controller.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  controllers: [MeController],
  providers: [AuthRepository, AuthService, AuthenticationGuard, RolesGuard],
  exports: [AuthRepository, AuthenticationGuard, RolesGuard],
})
export class AuthModule {}
