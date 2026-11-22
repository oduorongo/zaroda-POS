import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { FarmRoleCode } from '@prisma/client';
import { Farm, FarmFeature, FarmRequest, FarmRoles } from './farm-access';
import { FarmHealthService } from './farm-health.service';
import { FarmLivestockService } from './farm-livestock.service';
import {
  BreedingEventDto,
  CreateAnimalDto,
  CreateDrugDto,
  CreateGroupDto,
  DueDoneDto,
  ExitAnimalDto,
  GroupCountDto,
  HealthEventDto,
  ProgrammeDto,
  UpdateAnimalDto,
  VoidDto,
  WeightDto,
} from './dto/livestock.dto';

const { FARM_MANAGER, HERDSMAN, VET, SALES, STOREKEEPER } = FarmRoleCode;
const KEEPERS = [FARM_MANAGER, HERDSMAN, VET];

/** Zaroda Shamba F2: animals, groups and flocks, health, breeding, weights and what is due (docs/farm). */
@Farm()
@FarmFeature('livestock')
@Controller('farm')
export class FarmLivestockController {
  constructor(
    private readonly livestock: FarmLivestockService,
    private readonly health: FarmHealthService,
  ) {}

  @Get('animals')
  animals(@Req() req: FarmRequest, @Query('status') status?: string, @Query('species') species?: string, @Query('search') search?: string) {
    return this.livestock.listAnimals(req.farm!, { status, species, search });
  }

  @Get('animals/:id')
  animal(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.livestock.getAnimal(req.farm!, id);
  }

  @FarmRoles(...KEEPERS)
  @Post('animals')
  createAnimal(@Req() req: FarmRequest, @Body() dto: CreateAnimalDto) {
    return this.livestock.createAnimal(req.farm!, dto);
  }

  @FarmRoles(...KEEPERS)
  @Patch('animals/:id')
  updateAnimal(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAnimalDto) {
    return this.livestock.updateAnimal(req.farm!, id, dto);
  }

  @FarmRoles(FARM_MANAGER, HERDSMAN, SALES)
  @Post('animals/:id/exit')
  exitAnimal(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExitAnimalDto) {
    return this.livestock.exitAnimal(req.farm!, id, dto);
  }

  @Get('groups')
  groups(@Req() req: FarmRequest, @Query('closed') closed?: string) {
    return this.livestock.listGroups(req.farm!, closed === '1');
  }

  @Get('groups/:id')
  group(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.livestock.getGroup(req.farm!, id);
  }

  @FarmRoles(...KEEPERS)
  @Post('groups')
  createGroup(@Req() req: FarmRequest, @Body() dto: CreateGroupDto) {
    return this.livestock.createGroup(req.farm!, dto);
  }

  @FarmRoles(FARM_MANAGER, HERDSMAN, SALES)
  @Post('groups/:id/counts')
  changeCount(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupCountDto) {
    return this.livestock.changeCount(req.farm!, id, dto);
  }

  @FarmRoles(FARM_MANAGER)
  @Post('groups/:id/close')
  closeGroup(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.livestock.closeGroup(req.farm!, id);
  }

  @FarmRoles(...KEEPERS)
  @Post('weights')
  addWeight(@Req() req: FarmRequest, @Body() dto: WeightDto) {
    return this.livestock.addWeight(req.farm!, dto);
  }

  @FarmRoles(...KEEPERS)
  @Post('breeding')
  breeding(@Req() req: FarmRequest, @Body() dto: BreedingEventDto) {
    return this.livestock.recordBreeding(req.farm!, dto);
  }

  @FarmRoles(...KEEPERS)
  @Post('breeding/:id/void')
  voidBreeding(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.livestock.voidBreeding(req.farm!, id, dto);
  }

  @Get('drugs')
  drugs() {
    return this.health.listDrugs();
  }

  @FarmRoles(FARM_MANAGER, VET, STOREKEEPER)
  @Post('drugs')
  createDrug(@Body() dto: CreateDrugDto) {
    return this.health.createDrug(dto);
  }

  @FarmRoles(FARM_MANAGER, VET, STOREKEEPER)
  @Post('drugs/:id/retire')
  retireDrug(@Param('id', ParseUUIDPipe) id: string) {
    return this.health.retireDrug(id);
  }

  @FarmRoles(...KEEPERS)
  @Post('health')
  recordHealth(@Req() req: FarmRequest, @Body() dto: HealthEventDto) {
    return this.health.record(req.farm!, dto);
  }

  @FarmRoles(...KEEPERS)
  @Post('health/:id/void')
  voidHealth(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.health.voidEvent(req.farm!, id, dto);
  }

  @Get('withdrawals')
  withdrawals(@Req() req: FarmRequest) {
    return this.health.withdrawals(req.farm!);
  }

  @Get('due')
  due(@Req() req: FarmRequest, @Query('days') days?: string) {
    return this.health.due(req.farm!, Math.min(Math.max(Number(days) || 30, 1), 365));
  }

  @FarmRoles(...KEEPERS)
  @Post('due/:id/done')
  doneTask(@Req() req: FarmRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DueDoneDto) {
    return this.health.doneTask(req.farm!, id, dto);
  }

  @Get('programmes')
  programmes() {
    return this.health.listProgrammes();
  }

  @FarmFeature('programmes')
  @FarmRoles(FARM_MANAGER, VET)
  @Post('programmes')
  createProgramme(@Body() dto: ProgrammeDto) {
    return this.health.createProgramme(dto);
  }

  @FarmFeature('programmes')
  @FarmRoles(FARM_MANAGER, VET)
  @Post('programmes/:id/stop')
  stopProgramme(@Param('id', ParseUUIDPipe) id: string) {
    return this.health.stopProgramme(id);
  }
}
