import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  ConnectDeviceDto,
  ItemClassQueryDto,
  UpdateEtimsSettingsDto,
} from './dto/etims.dto';
import { EtimsCodesService } from './etims-codes.service';
import { EtimsSettingsService } from './etims-settings.service';

// eTIMS is the business's tax setup, so it is for owners and managers; an auditor can look.
const WRITERS = [Role.MANAGER, Role.OWNER];
const READERS = [Role.MANAGER, Role.OWNER, Role.AUDITOR];

@Controller('etims')
export class EtimsController {
  constructor(
    private readonly settings: EtimsSettingsService,
    private readonly codes: EtimsCodesService,
  ) {}

  @Roles(...READERS)
  @Get('settings')
  overview() {
    return this.settings.overview();
  }

  @Roles(...WRITERS)
  @Put('settings')
  update(@Body() dto: UpdateEtimsSettingsDto) {
    return this.settings.update(dto);
  }

  @Roles(...WRITERS)
  @Post('devices/:branchId/connect')
  @HttpCode(200)
  connect(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: ConnectDeviceDto,
  ) {
    return this.settings.connect(branchId, dto);
  }

  @Roles(...WRITERS)
  @Post('devices/:branchId/disconnect')
  @HttpCode(200)
  disconnect(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.settings.disconnect(branchId);
  }

  @Roles(...WRITERS)
  @Post('codes/sync')
  @HttpCode(200)
  sync() {
    return this.codes.sync();
  }

  @Roles(...READERS)
  @Get('codes/summary')
  summary() {
    return this.codes.counts();
  }

  @Roles(...READERS)
  @Get('codes')
  lists(@Query('cls') cls?: string) {
    return this.codes.lists(cls);
  }

  @Roles(...READERS)
  @Get('item-classes')
  itemClasses(@Query() q: ItemClassQueryDto) {
    return this.codes.searchItemClasses(q.search, q.limit);
  }
}
