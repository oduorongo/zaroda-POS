import { IsBooleanString, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ListRosterShiftsDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  orgUserId?: string;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  // String, not boolean - query params always arrive as strings (see
  // ListInventoryDto/ListAppointmentsDto for the same convention elsewhere
  // in this codebase).
  @IsBooleanString()
  @IsOptional()
  publishedOnly?: string;
}
