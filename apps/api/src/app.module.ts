import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuditLogModule } from './common/audit/audit-log.module';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { TenantRateLimitGuard } from './common/tenant/tenant-rate-limit.guard';
import { ModuleRegistryModule } from './module-registry/module-registry.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { SalesModule } from './sales/sales.module';
import { ShiftsModule } from './shifts/shifts.module';
import { ReportsModule } from './reports/reports.module';
import { OrgUsersModule } from './org-users/org-users.module';
import { StockTransfersModule } from './stock-transfers/stock-transfers.module';
import { StockTakesModule } from './stock-takes/stock-takes.module';
import { CustomersModule } from './customers/customers.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { BranchesModule } from './branches/branches.module';
import { TerminalsModule } from './terminals/terminals.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { PublicPlansModule } from './public-plans/public-plans.module';
import { PublicBookingModule } from './public-booking/public-booking.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LayawaysModule } from './layaways/layaways.module';
import { AllExceptionsFilter } from './common/logging/all-exceptions.filter';
import { RestaurantModule } from './restaurant/restaurant.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { SalonModule } from './salon/salon.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { ServiceJobsModule } from './service-jobs/service-jobs.module';
import { PayrollModule } from './payroll/payroll.module';
import { RosterModule } from './roster/roster.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { RepackagingModule } from './repackaging/repackaging.module';
import { RecipesModule } from './recipes/recipes.module';
import { WasteModule } from './waste/waste.module';

// Phase 1+ will import vertical module packages here and register their
// manifests on ModuleRegistryService at bootstrap (see DESIGN.md §3) - none
// exist yet, so the registry starts empty.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        // Every log line JSON with a requestId - the correlation key that
        // ties a request's access log, any error inside it, and the
        // AuditLog row it produced together, so a support/incident
        // investigation isn't limited to timestamp-nearby guessing.
        genReqId: (req) =>
          (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
        // Pretty-printed in local dev (readable in a terminal); plain JSON
        // in production, since that's what a log aggregator actually
        // wants to ingest.
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        // pino-http's default request serializer never includes the body
        // (only method/url/headers/etc), so login/PIN payloads are never
        // logged in the first place - nothing to redact there. The
        // Authorization header and any cookie are the only credential-
        // bearing fields that DO appear in the default serialized request,
        // so those are what actually need redacting.
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[REDACTED]',
        },
        customLogLevel: (_req, res, err) => {
          if (res.statusCode >= 500 || err) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      },
    }),
    // Global default: 100 requests/minute per IP - generous enough not to
    // interfere with a busy terminal's normal traffic. auth.controller.ts
    // overrides this to a much stricter limit on /auth/login and
    // /auth/pin-login specifically, since those are the only public
    // (pre-JWT) endpoints and pin-login's 4-8 digit PIN has as few as
    // 10,000 possible values - with no rate limit at all, that's
    // trivially brute-forceable (found during the Phase 3 PCI/security
    // review; there was previously no throttling anywhere in the app).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuditLogModule,
    NotificationsModule,
    ModuleRegistryModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    PaymentsModule,
    SalesModule,
    ShiftsModule,
    ReportsModule,
    OrgUsersModule,
    PayrollModule,
    RosterModule,
    StockTransfersModule,
    StockTakesModule,
    PurchasingModule,
    RepackagingModule,
    RecipesModule,
    WasteModule,
    CustomersModule,
    OrganizationsModule,
    BranchesModule,
    TerminalsModule,
    PlatformAdminModule,
    PublicPlansModule,
    PublicBookingModule,
    LayawaysModule,
    RestaurantModule,
    PharmacyModule,
    SalonModule,
    ManufacturingModule,
    ServiceJobsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: ThrottlerGuard runs first (IP-based, doesn't need
    // req.user) so rate limiting applies even to @Public() routes like
    // /auth/login and /auth/pin-login; JwtAuthGuard then populates
    // req.user, RolesGuard reads it, TenantRateLimitGuard runs last of the
    // guards (it needs req.user.organizationId, which only exists once
    // JwtAuthGuard has run - see that guard's own comment), and
    // TenantContextInterceptor (below) reads it after every guard has run.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantRateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
