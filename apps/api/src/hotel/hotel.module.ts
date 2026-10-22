import { Module } from '@nestjs/common';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnlineOrdersModule } from '../online-orders/online-orders.module';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { HotelController, PublicHotelsController } from './hotel.controller';
import { HotelPublicService } from './hotel-public.service';
import { HotelRoomsService } from './hotel-rooms.service';
import { FrontDeskController } from './front-desk.controller';
import { PhysicalRoomsService } from './physical-rooms.service';
import { FrontDeskService } from './front-desk.service';
import { FrontDeskStayService } from './front-desk-stay.service';
import { HotelFolioService } from './hotel-folio.service';
import { RoomChargeService } from './room-charge.service';
import { SalesModule } from '../sales/sales.module';
import { RoomBookingsService } from './room-bookings.service';
import { RoomBookingAutoCompleteService } from './room-booking-autocomplete.service';
import { HospitalityAdminService } from './hospitality-admin.service';

/**
 * Hotel rooms for a restaurant business: room types with photos and a nightly price, advertised on the marketplace's
 * Hotels page, booked by guests (no account) with a deposit paid to the hotel's own shop payment account. Uses the
 * Online Shop add-on's live shop for the hotel's name, location and payment setup. Its tables are listed in the
 * RESTAURANT manifest (restaurant.module.ts) - there is only one manifest per industry.
 */
@Module({
  imports: [OnlineOrdersModule, OnlineStoreModule, NotificationsModule, SalesModule],
  controllers: [HotelController, FrontDeskController, PublicHotelsController],
  providers: [PhysicalRoomsService, FrontDeskService, FrontDeskStayService, HotelFolioService, RoomChargeService, HotelRoomsService, HotelPublicService, RoomBookingsService, RoomBookingAutoCompleteService, HospitalityAdminService, ObjectStorageService],
  // The platform admin can run the automatic completion by hand and reads the hotel and table-order overviews.
  exports: [RoomBookingAutoCompleteService, HospitalityAdminService],
})
export class HotelModule {}
