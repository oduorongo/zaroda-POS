import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ImportDecisionDto {
  @IsIn(['APPROVE', 'CANCEL'])
  decision!: 'APPROVE' | 'CANCEL';

  /** The product the imported item is (needed to approve). */
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(400)
  remark?: string;
}
