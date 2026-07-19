import { IsEnum } from 'class-validator';
import { RestaurantTableStatus } from '@prisma/client';

export class UpdateTableStatusDto {
  @IsEnum(RestaurantTableStatus)
  status!: RestaurantTableStatus;
}
