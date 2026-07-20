import { IsString, Length } from 'class-validator';

/** Same 4-8 char shape as PinLoginDto's pin field - whatever range a terminal PIN pad accepts. */
export class SetPinDto {
  @IsString()
  @Length(4, 8)
  pin!: string;
}
