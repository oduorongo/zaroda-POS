import { IsDateString, IsString, MaxLength } from 'class-validator';

export class PrescriptionInputDto {
  @IsString()
  @MaxLength(100)
  prescriptionNumber!: string;

  @IsString()
  @MaxLength(200)
  prescriberName!: string;

  @IsDateString()
  issuedDate!: string;
}
