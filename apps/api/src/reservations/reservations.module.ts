import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnlineOrdersModule } from '../online-orders/online-orders.module';
import { PublicReservationsController, RestaurantReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

/**
 * Table reservations for a restaurant: guests ask for a table from the marketplace, the restaurant confirms or declines.
 * Uses the live online shop for the restaurant's name and contact number. Its table is listed in the RESTAURANT manifest
 * (restaurant.module.ts) - there is only one manifest per industry.
 */
@Module({
  imports: [OnlineOrdersModule, NotificationsModule],
  controllers: [RestaurantReservationsController, PublicReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
