import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  AddTabLinesDto,
  BillQueryDto,
  CancelTabDto,
  CloseSplitDto,
  CloseTabDto,
  MoveTabDto,
  OpenTabDto,
  RestaurantSettingsDto,
  VoidTabLineDto,
} from './dto/tab.dto';
import { RestaurantTabPaymentsService } from './restaurant-tab-payments.service';
import { RestaurantTablesService } from './restaurant-tables.service';
import { RestaurantTabsService } from './restaurant-tabs.service';

// Reads are open to any signed-in role, like the rest of the floor. Writes name their roles: whoever works the floor
// (cashier up) can open a bill, add items, move it and take payment; voiding an item needs a supervisor (checked, with the
// reason, in the service - an item-by-item rule, not just a role).
const FLOOR_STAFF = [Role.CASHIER, Role.SUPERVISOR, Role.MANAGER, Role.OWNER];
const SUPERVISORS = [Role.SUPERVISOR, Role.MANAGER, Role.OWNER];

@Controller('restaurant')
export class RestaurantTabsController {
  constructor(
    private readonly tabs: RestaurantTabsService,
    private readonly payments: RestaurantTabPaymentsService,
    private readonly tables: RestaurantTablesService,
  ) {}

  // ── By table ──
  @Roles(...FLOOR_STAFF)
  @Post('tables/:tableId/tabs')
  open(
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @Body() dto: OpenTabDto,
  ) {
    return this.tabs.open(tableId, dto);
  }

  @Get('tables/:tableId/tab')
  openTab(@Param('tableId', ParseUUIDPipe) tableId: string) {
    return this.tabs.openTabForTable(tableId);
  }

  @Get('tables/:tableId/held-courses')
  held(@Param('tableId', ParseUUIDPipe) tableId: string) {
    return this.tabs.heldCourses(tableId);
  }

  @Roles(...FLOOR_STAFF)
  @Post('tables/:tableId/clean')
  @HttpCode(200)
  clean(@Param('tableId', ParseUUIDPipe) tableId: string) {
    return this.tables.markClean(tableId);
  }

  // ── By tab ──
  @Get('tabs/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tabs.view(id);
  }

  @Get('tabs/:id/bill')
  bill(@Param('id', ParseUUIDPipe) id: string, @Query() query: BillQueryDto) {
    return this.tabs.bill(id, query);
  }

  @Roles(...FLOOR_STAFF)
  @Post('tabs/:id/lines')
  add(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTabLinesDto) {
    return this.tabs.addLines(id, dto);
  }

  @Roles(...SUPERVISORS)
  @Post('tabs/:id/lines/:lineId/void')
  @HttpCode(200)
  voidLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: VoidTabLineDto,
  ) {
    return this.tabs.voidLine(id, lineId, dto);
  }

  @Roles(...FLOOR_STAFF)
  @Post('tabs/:id/move')
  @HttpCode(200)
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveTabDto) {
    return this.tabs.move(id, dto);
  }

  // A bill with items on it can only be thrown away by a supervisor; the service checks that (an empty one, by anyone).
  @Roles(...FLOOR_STAFF)
  @Post('tabs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTabDto) {
    return this.tabs.cancel(id, dto);
  }

  @Roles(...FLOOR_STAFF)
  @Post('tabs/:id/courses/:courseNumber/fire')
  @HttpCode(200)
  fire(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('courseNumber', ParseIntPipe) courseNumber: number,
  ) {
    return this.tabs.fireCourse(id, courseNumber);
  }

  @Roles(...FLOOR_STAFF)
  @Post('tabs/:id/close')
  @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseTabDto) {
    return this.payments.close(id, dto);
  }

  @Roles(...FLOOR_STAFF)
  @Post('tabs/:id/close-split')
  @HttpCode(200)
  closeSplit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseSplitDto,
  ) {
    return this.payments.closeSplit(id, dto);
  }

  // ── Settings ──
  @Get('settings')
  settings(@Query('branchId', ParseUUIDPipe) branchId: string) {
    return this.tables.getSettings(branchId);
  }

  @Roles(...SUPERVISORS)
  @Put('settings')
  saveSettings(@Body() dto: RestaurantSettingsDto) {
    return this.tables.saveSettings(dto);
  }
}
