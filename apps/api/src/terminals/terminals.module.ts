import { Module } from '@nestjs/common';
import { TerminalsController } from './terminals.controller';
import { TerminalsService } from './terminals.service';

@Module({
  controllers: [TerminalsController],
  providers: [TerminalsService],
})
export class TerminalsModule {}
