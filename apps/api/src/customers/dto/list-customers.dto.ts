import { IsOptional, IsString } from 'class-validator';

export class ListCustomersDto {
  // Partial match on phone or name - the register's "look up a customer"
  // search, not an exact-match filter.
  @IsString()
  @IsOptional()
  search?: string;
}
