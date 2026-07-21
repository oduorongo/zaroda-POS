import { IsString, MinLength } from 'class-validator';

export class CancelBookingDto {
  @IsString()
  @MinLength(1)
  token!: string;
}
