import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_PARTY_SIZE } from '../reservation.util';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** A guest asking a restaurant for a table. No account: a name and a phone number the restaurant can reach. */
export class CreateReservationDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_PARTY_SIZE)
  partySize!: number;

  /** YYYY-MM-DD */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Choose the date you would like the table for' })
  date!: string;

  /** 24-hour, e.g. 19:30 */
  @Matches(/^\d{2}:\d{2}$/, { message: 'Choose the time, for example 19:30' })
  time!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}

/** The secret the guest's browser was given when the request was made. */
export class GuestReservationTokenDto {
  @IsString()
  @MaxLength(200)
  token!: string;
}

export class ConfirmReservationDto {
  /** Which table the party will have (optional, but it lets the floor show who is expected where). */
  @IsOptional()
  @IsUUID()
  tableId?: string;

  /** Added to the guest's confirmation text, e.g. "We'll hold the table for 15 minutes". */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  message?: string;
}

export class DeclineReservationDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  reason!: string;
}

export class ReservationSettingsDto {
  @IsBoolean()
  enabled!: boolean;
}
