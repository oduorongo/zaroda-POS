import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

// JwtAuthGuard is global (see app.module.ts). No @Roles() anywhere here -
// opening/closing a shift and reading its own cash-reconciliation report
// are a cashier's routine, self-service actions, not a management-only view
// (unlike the full inventory ledger or a sale void).
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post()
  open(@Body() dto: OpenShiftDto) {
    return this.shifts.open(dto);
  }

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('terminalId') terminalId?: string,
    @Query('open') open?: string,
  ) {
    return this.shifts.findAll({
      branchId,
      terminalId,
      open: open === undefined ? undefined : open === 'true',
    });
  }

  @Get(':id/report')
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.report(id);
  }

  @Patch(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseShiftDto) {
    return this.shifts.close(id, dto);
  }
}
