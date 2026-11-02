import { Module } from '@nestjs/common';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { SeasonalBillingController, SeasonalCallbackController } from './seasonal-billing.controller';
import { SeasonalBillingService } from './seasonal-billing.service';
import { SeasonalPaymentsService } from './seasonal-payments.service';
import { SeasonalReadOnlyInterceptor } from './seasonal-read-only.interceptor';
import { SeasonalSchedulerService } from './seasonal-scheduler.service';

@Module({
  // TumaClient - instalments are paid to ZARODA's own Tuma account.
  imports: [OnlineStoreModule],
  controllers: [SeasonalBillingController, SeasonalCallbackController],
  providers: [SeasonalBillingService, SeasonalPaymentsService, SeasonalSchedulerService, SeasonalReadOnlyInterceptor],
  // Signup (auth, platform onboarding) starts seasonal subscriptions; the app module registers the read-only interceptor.
  exports: [SeasonalBillingService, SeasonalReadOnlyInterceptor],
})
export class SeasonalBillingModule {}
