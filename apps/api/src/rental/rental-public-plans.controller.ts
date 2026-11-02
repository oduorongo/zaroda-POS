import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PLAN_ORDER, RENTAL_PLANS } from './rental-plans.util';

/** The ZARODA RENTALS price list for the public pricing page (rentals.zarodasolutions.app/pricing). */
@Controller('public/rental-plans')
export class RentalPublicPlansController {
  @Public()
  @Get()
  plans() {
    return PLAN_ORDER.map((code) => RENTAL_PLANS[code]);
  }
}
