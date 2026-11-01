import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { ConRoleCode } from '@prisma/client';
import { CUSTOM_ROLE_GRANTS } from '../common/con-defaults';

export const API_SCOPES = ['projects', 'ipcs', 'reports'] as const;

export class OfficeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  county?: string;
}

export class AssignOfficeDto {
  /** null takes them out of any office. */
  @ValidateIf((o: AssignOfficeDto) => o.officeId !== null)
  @IsUUID()
  officeId!: string | null;
}

export class CustomRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(CUSTOM_ROLE_GRANTS, { each: true })
  grants!: ConRoleCode[];

  /** The most this role may approve (LPOs, requisitions); leave out to use the granted jobs' own limits. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  approvalLimit?: number | null;
}

export class AssignCustomRolesDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  customRoleIds!: string[];
}

export class ApiKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(API_SCOPES, { each: true })
  scopes!: (typeof API_SCOPES)[number][];
}
