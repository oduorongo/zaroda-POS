import { Module } from '@nestjs/common';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnlineOrdersModule } from '../online-orders/online-orders.module';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { HotelController, PublicHotelsController } from './hotel.controller';
import { HotelPublicService } from './hotel-public.service';
import { HotelRoomsService } from './hotel-rooms.service';
import { RoomBookingsService } from './room-bookings.service';
import { RoomBookingAutoCompleteService } from './room-booking-autocomplete.service';

/**
 * Hotel rooms for a restaurant business: room types with photos and a nightly price, advertised on the marketplace's
 * Hotels page, booked by guests (no account) with a deposit paid to the hotel's own shop payment account. Uses the
 * Online Shop add-on's live shop for the hotel's name, location and payment setup. Its tables are listed in the
 * RESTAURANT manifest (restaurant.module.ts) - there is only one manifest per industry.
 */
@Module({
  imports: [OnlineOrdersModule, OnlineStoreModule, NotificationsModule],
  controllers: [HotelController, PublicHotelsController],
  providers: [HotelRoomsService, HotelPublicService, RoomBookingsService, RoomBookingAutoCompleteService, ObjectStorageService],
  // The platform admin can run the automatic completion by hand.
  exports: [RoomBookingAutoCompleteService],
})
export class HotelModule {}
