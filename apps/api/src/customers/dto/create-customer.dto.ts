import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** A KRA PIN: a letter (A for a person, P for a company), nine digits, a letter. */
export const KRA_PIN_PATTERN = /^[AP]\d{9}[A-Z]$/;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || undefined : value;

export class CreateCustomerDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(20)
  @IsOptional()
  phone?: string;

  @Transform(upper)
  @Matches(KRA_PIN_PATTERN, { message: 'A KRA PIN is a letter, nine digits and a letter, e.g. A123456789Z' })
  @IsOptional()
  kraPin?: string;
}

export class UpdateCustomerDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  /** null clears it. */
  @Transform(upper)
  @Matches(KRA_PIN_PATTERN, { message: 'A KRA PIN is a letter, nine digits and a letter, e.g. A123456789Z' })
  @IsOptional()
  kraPin?: string | null;
}
