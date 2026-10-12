import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { BuyerAuthGuard, CurrentBuyerId } from '../online-orders/buyer-auth';
import { CurrentRiderId, RiderAuthGuard } from '../riders/rider-auth';
import { DeliveryRiderService } from './delivery-rider.service';
import { DeliveryService } from './delivery.service';
import { CancelDeliveryDto, DeliverDto, QuoteDto, RequestDeliveryDto } from './dto/delivery.dto';

/** The business asks for a rider for an accepted delivery order - staff JWT (global guard), tenant-scoped. */
@Controller('online-orders')
@Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
export class DeliveryStaffController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get(':id/delivery')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.getForOrder(id);
  }

  @Post(':id/delivery')
  request(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestDeliveryDto) {
    return this.delivery.requestRider(id, dto);
  }

  @Post(':id/delivery/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    return this.delivery.cancelRequest(id, dto);
  }
}

/** The buyer watches the quotes on their own order and picks one - buyer token only. */
@Controller('buyer/orders')
@Public()
@UseGuards(BuyerAuthGuard)
export class DeliveryBuyerController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get(':id/delivery')
  get(@CurrentBuyerId() buyerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.getForBuyer(buyerId, id);
  }

  @Post(':id/delivery/quotes/:quoteId/accept')
  @HttpCode(200)
  accept(@CurrentBuyerId() buyerId: string, @Param('id', ParseUUIDPipe) id: string, @Param('quoteId', ParseUUIDPipe) quoteId: string) {
    return this.delivery.acceptQuote(buyerId, id, quoteId);
  }
}

/** The rider's jobs - rider token only. */
@Controller('rider/jobs')
@Public()
@UseGuards(RiderAuthGuard)
export class DeliveryRiderController {
  constructor(private readonly jobs: DeliveryRiderService) {}

  @Get('open')
  open(@CurrentRiderId() riderId: string) {
    return this.jobs.listOpen(riderId);
  }

  @Get('mine')
  mine(@CurrentRiderId() riderId: string) {
    return this.jobs.listMine(riderId);
  }

  @Post(':id/quote')
  @HttpCode(200)
  quote(@CurrentRiderId() riderId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteDto) {
    return this.jobs.quote(riderId, id, dto);
  }

  @Delete(':id/quote')
  withdraw(@CurrentRiderId() riderId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.withdrawQuote(riderId, id);
  }

  @Post(':id/pickup')
  @HttpCode(200)
  pickUp(@CurrentRiderId() riderId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.pickUp(riderId, id);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(@CurrentRiderId() riderId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto) {
    return this.jobs.deliver(riderId, id, dto);
  }
}
