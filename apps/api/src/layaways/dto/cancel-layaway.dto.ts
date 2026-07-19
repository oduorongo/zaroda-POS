import { IsString, MaxLength } from 'class-validator';

export class CancelLayawayDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
