import { IsEmail, IsString, MinLength } from 'class-validator';

export class PlatformAdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
