import { IsString, IsUUID, Length } from 'class-validator';

export class PinLoginDto {
  @IsUUID()
  terminalId!: string;

  @IsUUID()
  orgUserId!: string;

  @IsString()
  @Length(4, 8)
  pin!: string;
}
