import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  // KRA PIN format (e.g. P051234567X) isn't validated server-side - format
  // rules occasionally change and a tenant's back office shouldn't hard-
  // reject a value KRA itself would accept; MaxLength just guards against
  // garbage input.
  @IsString()
  @MaxLength(20)
  @IsOptional()
  kraPin?: string;

  @IsBoolean()
  @IsOptional()
  vatRegistered?: boolean;
}
