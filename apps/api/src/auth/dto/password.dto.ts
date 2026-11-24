import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;
}

export class ResetPasswordDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @Matches(/^\d{6}$/, { message: 'The code is the 6 digits in the email' })
  code!: string;

  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for the new password' })
  @MaxLength(100)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, 100)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for the new password' })
  @MaxLength(100)
  newPassword!: string;
}

export class SetStaffPasswordDto {
  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for the new password' })
  @MaxLength(100)
  newPassword!: string;
}
