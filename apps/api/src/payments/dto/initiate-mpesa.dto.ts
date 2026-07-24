import { IsNumber, IsPositive, IsString, IsUUID, Matches } from 'class-validator';

export class InitiateMpesaDto {
  @IsNumber()
  @IsPositive()
  amountKes!: number;

  // Client-generated UUID, same one the terminal will use as the
  // eventual /sales POST's clientId - see MpesaStkRequest.reference.
  @IsUUID()
  reference!: string;

  // Daraja wants 2547XXXXXXXX (no leading +, no leading 0).
  @IsString()
  @Matches(/^254[17]\d{8}$/, {
    message: 'phoneNumber must be in 2547XXXXXXXX or 2541XXXXXXXX format',
  })
  phoneNumber!: string;
}
