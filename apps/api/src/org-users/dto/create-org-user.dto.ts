import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

/**
 * `fullName`/`password` are only required when `email` doesn't already
 * match an existing `User` account - checked in the service, not here,
 * since class-validator's conditional validation would obscure this
 * simple a rule. An existing user (e.g. an accountant contracted to
 * several shops - see the User model's own comment) just gets a new
 * membership in this org; their name/password are theirs already.
 */
export class CreateOrgUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  fullName?: string;

  @IsString()
  @MinLength(8)
  @IsOptional()
  password?: string;

  @IsEnum(Role)
  role!: Role;

  @IsUUID()
  @IsOptional()
  branchId?: string;
}
