import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformAdminJwtStrategy } from './platform-admin-jwt.strategy';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { RidersModule } from '../riders/riders.module';
import { RentalModule } from '../rental/rental.module';
import { HotelModule } from '../hotel/hotel.module';
import { TenderAdvertsModule } from '../tender-adverts/tender-adverts.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PlatformAccountingController } from './platform-accounting.controller';

@Module({
  imports: [
    PassportModule,
    // CommissionService - commission invoicing is a platform-admin job.
    OnlineStoreModule,
    // RidersService - approving delivery riders is a platform-admin job.
    RidersModule,
    // RentalPlatformPaymentsService - recording and waiving landlords' rental invoices is a platform-admin job.
    RentalModule,
    // RoomBookingAutoCompleteService - completing hotel stays nobody checked out can be run by hand.
    HotelModule,
    // TenderAdminService - approving schools and taking tender adverts down is a platform-admin job.
    TenderAdvertsModule,
    // PlatformLedgerService - ZARODA's own books.
    AccountingModule,
    // A second, independent JwtModule registration (separate from
    // AuthModule's) - its own secret (PLATFORM_ADMIN_JWT_SECRET), its
    // own JwtService instance. Deliberately not sharing JWT_SECRET with
    // tenant tokens - see PlatformAdminJwtStrategy's comment.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('PLATFORM_ADMIN_JWT_SECRET'),
        signOptions: {
          expiresIn:
            config.get<string>('PLATFORM_ADMIN_JWT_EXPIRES_IN') ?? '4h',
        },
      }),
    }),
  ],
  controllers: [PlatformAdminController, PlatformAccountingController],
  providers: [
    PlatformAdminAuthService,
    PlatformAdminService,
    PlatformAuditLogService,
    PlatformAdminJwtStrategy,
  ],
  // The marketing teams module onboards businesses through the same code the platform admin uses.
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
