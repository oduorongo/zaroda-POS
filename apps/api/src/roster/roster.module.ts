import { Module } from '@nestjs/common';
import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';

/** Core, not industry-gated - every tenant has staff to schedule regardless of vertical. */
@Module({
  controllers: [RosterController],
  providers: [RosterService],
})
export class RosterModule {}
