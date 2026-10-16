import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { RidersModule } from '../riders/riders.module';
import { PasswordChangedGuard, SalesAgentJwtStrategy } from './sales-agent-auth';
import { TumaClient } from '../online-store/tuma.client';
import { MpesaB2cClient } from './mpesa-b2c.client';
import { SalesPayoutsService } from './sales-payouts.service';
import { SalesAgentService } from './sales-agent.service';
import { SalesEarningsScheduler } from './sales-earnings.scheduler';
import { SalesEarningsService } from './sales-earnings.service';
import { SalesPortalService } from './sales-portal.service';
import {
  SalesAgentController,
  SalesAgentsAdminController,
  SalesEarningsAdminController,
  SalesEarningsAgentController,
  SalesPayoutCallbackController,
  SalesPortalController,
  SalesTeamsAdminController,
} from './sales-teams.controller';
import { SalesTeamsService } from './sales-teams.service';

@Module({
  imports: [
    PassportModule,
    // Onboarding a shop or a rider goes through the same code the platform admin uses.
    PlatformAdminModule,
    RidersModule,
    // Same secret as shoppers and riders, told apart by the scope claim (see sales-agent-auth.ts). A working day, not a month:
    // these accounts see other people's businesses.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BUYER_JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('SALES_AGENT_JWT_EXPIRES_IN') ?? '12h' },
      }),
    }),
  ],
  controllers: [
    SalesTeamsAdminController,
    SalesAgentsAdminController,
    SalesAgentController,
    SalesPortalController,
    SalesEarningsAgentController,
    SalesEarningsAdminController,
    SalesPayoutCallbackController,
  ],
  providers: [SalesAgentJwtStrategy, PasswordChangedGuard, SalesAgentService, SalesPortalService, SalesTeamsService, SalesEarningsService, SalesPayoutsService, MpesaB2cClient, TumaClient, SalesEarningsScheduler],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
