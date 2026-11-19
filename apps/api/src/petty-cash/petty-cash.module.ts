import { Module } from '@nestjs/common';
import { DocumentNumbersService } from '../school-supplier/document-numbers.service';
import { PettyCashController } from './petty-cash.controller';
import { PettyCashService } from './petty-cash.service';

/** Petty cash for every business type: boxes, vouchers (also expenses), top-ups and counts. */
@Module({
  controllers: [PettyCashController],
  providers: [PettyCashService, DocumentNumbersService],
})
export class PettyCashModule {}
