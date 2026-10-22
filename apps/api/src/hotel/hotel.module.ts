import { Module, OnModuleInit } from '@nestjs/common';
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
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { RoomBookingsService } from './room-bookings.service';
import { RoomBookingAutoCompleteService } from './room-booking-autocomplete.service';
import { HospitalityAdminService } from './hospitality-admin.service';
import { HotelOpsController } from './hotel-ops.controller';
import { HotelSettingsService } from './hotel-settings.service';
import { HotelGuestsService } from './hotel-guests.service';
import { HotelChangesService } from './hotel-changes.service';
import { HotelNotifierService } from './hotel-notifier.service';
import { HotelReportsService } from './hotel-reports.service';
import { HotelSchedulerService } from './hotel-scheduler.service';
import { NightAuditService } from './night-audit.service';

/**
 * Hotel rooms for a restaurant business: room types with photos and a nightly price, advertised on the marketplace's
 * Hotels page, booked by guests (no account) with a deposit paid to the hotel's own shop payment account. Uses the
 * Online Shop add-on's live shop for the hotel's name, location and payment setup. Its tables are listed in the
 * RESTAURANT manifest (restaurant.module.ts) - there is only one manifest per industry.
 */
@Module({
  imports: [OnlineOrdersModule, OnlineStoreModule, NotificationsModule, SalesModule, ModuleRegistryModule],
  controllers: [HotelController, FrontDeskController, HotelOpsController, PublicHotelsController],
  providers: [PhysicalRoomsService, FrontDeskService, FrontDeskStayService, HotelFolioService, RoomChargeService, HotelRoomsService, HotelPublicService, RoomBookingsService, RoomBookingAutoCompleteService, HospitalityAdminService, ObjectStorageService, HotelSettingsService, HotelGuestsService, HotelChangesService, HotelNotifierService, HotelReportsService, HotelSchedulerService, NightAuditService],
  // The platform admin can run the automatic completion by hand and reads the hotel and table-order overviews.
  exports: [RoomBookingAutoCompleteService, HospitalityAdminService],
})
export class HotelModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'HOTEL',
      entityExtensions: [
        { tableName: 'hotel_room_types', description: 'Kinds of room, with price and how many' },
        { tableName: 'hotel_rooms', description: 'The real rooms (101, 102...) and their housekeeping status' },
        { tableName: 'room_bookings', description: 'Stays booked on the marketplace, at the front desk or by phone' },
        { tableName: 'hotel_room_assignments', description: 'Which room(s) a stay is in, and the history of room moves' },
        { tableName: 'hotel_folios', description: 'A guest\'s running account for a stay' },
        { tableName: 'hotel_folio_entries', description: 'Room nights, charges, payments, refunds and adjustments on a folio (only ever added)' },
        { tableName: 'hotel_settings', description: 'Cancellation policy, night audit hour and which guest texts to send' },
        { tableName: 'hotel_taxes', description: 'Room taxes and levies, as percentages the business sets' },
        { tableName: 'hotel_rate_cards', description: 'Weekend price and extra-guest prices per room type' },
        { tableName: 'hotel_seasons', description: 'Seasonal price ranges per room type' },
        { tableName: 'hotel_meal_prices', description: 'Meal plan prices per room type' },
        { tableName: 'hotel_guests', description: 'The guest register (ID numbers encrypted)' },
        { tableName: 'hotel_night_audits', description: 'The daily close and its summary' },
        { tableName: 'hotel_notifications', description: 'Guest messages sent or skipped, so none goes twice' },
      ],
    });
  }
}
