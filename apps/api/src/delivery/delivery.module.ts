import { Module } from '@nestjs/common';
import { DeliveryRiderService } from './delivery-rider.service';
import { DeliveryBuyerController, DeliveryRiderController, DeliveryStaffController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

// The buyer and rider guards use the JWT strategies registered by OnlineOrdersModule and RidersModule
// (Passport strategies are application-wide), so nothing needs importing here.
@Module({
  controllers: [DeliveryStaffController, DeliveryBuyerController, DeliveryRiderController],
  providers: [DeliveryService, DeliveryRiderService],
})
export class DeliveryModule {}
