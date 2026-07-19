import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuditLogModule } from './common/audit/audit-log.module';
import { TenantContextInterceptor } from './common/tenant/tenant-context.interceptor';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { ModuleRegistryModule } from './module-registry/module-registry.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { SalesModule } from './sales/sales.module';
import { ShiftsModule } from './shifts/shifts.module';

// Phase 1+ will import vertical module packages here and register their
// manifests on ModuleRegistryService at bootstrap (see DESIGN.md §3) - none
// exist yet, so the registry starts empty.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuditLogModule,
    ModuleRegistryModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    PaymentsModule,
    SalesModule,
    ShiftsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: JwtAuthGuard populates req.user, RolesGuard reads it,
    // TenantContextInterceptor (below) reads it after both guards have run.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
