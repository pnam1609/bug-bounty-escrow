import { Module } from '@nestjs/common';

import {
  OwnerProgramController,
  ProgramController,
  TransactionController,
} from './program.controller.js';
import { ProgramRepository } from './program.repository.js';
import { ProgramService } from './program.service.js';

@Module({
  controllers: [ProgramController, OwnerProgramController, TransactionController],
  providers: [ProgramRepository, ProgramService],
  exports: [ProgramRepository, ProgramService],
})
export class ProgramModule {}
