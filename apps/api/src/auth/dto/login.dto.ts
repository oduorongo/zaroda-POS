import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /** Required only if the account belongs to more than one organization. */
  @IsUUID()
  @IsOptional()
  organizationId?: string;
}
