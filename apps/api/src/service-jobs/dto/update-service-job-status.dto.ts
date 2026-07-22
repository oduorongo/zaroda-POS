import { IsIn } from 'class-validator';
import { ServiceJobStatus } from '@prisma/client';

export class UpdateServiceJobStatusDto {
  @IsIn([
    'OPEN',
    'IN_PROGRESS',
    'WAITING_PARTS',
    'COMPLETED',
    'CANCELLED',
  ] satisfies ServiceJobStatus[])
  status!: ServiceJobStatus;
}
