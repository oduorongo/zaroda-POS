import { Body, Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { OnlineStoreService } from './online-store.service';
import { ConnectTumaDto, UpdateOnlineStoreDto } from './dto/update-online-store.dto';

// Each attempt makes an outbound call to TUMA - throttled so this endpoint
// can't be used to hammer TUMA or brute-force API keys through Zaroda.
const TUMA_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

// Owner/manager only throughout - this is where payment credentials and
// the public face of the business are configured. JwtAuthGuard is global.
@Controller('online-store/me')
@Roles(Role.MANAGER, Role.OWNER)
export class OnlineStoreController {
  constructor(private readonly onlineStore: OnlineStoreService) {}

  @Get()
  getMine() {
    return this.onlineStore.getMine();
  }

  @Patch()
  updateMine(@Body() dto: UpdateOnlineStoreDto) {
    return this.onlineStore.updateMine(dto);
  }

  @Throttle(TUMA_THROTTLE)
  @Post('tuma')
  connectTuma(@Body() dto: ConnectTumaDto) {
    return this.onlineStore.connectTuma(dto);
  }

  @Delete('tuma')
  disconnectTuma() {
    return this.onlineStore.disconnectTuma();
  }
}
