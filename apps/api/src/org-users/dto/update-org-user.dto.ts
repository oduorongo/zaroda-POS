import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateOrgUserDto {
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  /** null clears the branch scope (access to all branches) - undefined leaves it unchanged. */
  @IsUUID()
  @IsOptional()
  branchId?: string | null;
}
