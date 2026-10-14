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
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RentalService } from './rental.service';
import { RentalBillingService } from './rental-billing.service';
import {
  BulkCreateUnitsDto,
  CreateChargeDto,
  CreateLeaseDto,
  CreatePropertyDto,
  CreateTenantDto,
  CreateUnitDto,
  EndLeaseDto,
  RecordPaymentDto,
  UpdatePropertyDto,
  UpdateTenantDto,
  UpdateUnitDto,
  VoidPaymentDto,
} from './dto/rental.dto';

// JwtAuthGuard/RolesGuard are global. Reading is open to any signed-in role;
// changing properties, units, tenants and leases is for managers and owners.
@Controller('rental')
export class RentalController {
  constructor(
    private readonly rental: RentalService,
    private readonly billing: RentalBillingService,
  ) {}

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('properties')
  createProperty(@Body() dto: CreatePropertyDto) {
    return this.rental.createProperty(dto);
  }

  @Get('properties')
  listProperties() {
    return this.rental.listProperties();
  }

  @Get('properties/:id')
  getProperty(@Param('id', ParseUUIDPipe) id: string) {
    return this.rental.getProperty(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('properties/:id')
  updateProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.rental.updateProperty(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('units')
  createUnit(@Body() dto: CreateUnitDto) {
    return this.rental.createUnit(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('units/bulk')
  createUnitsBulk(@Body() dto: BulkCreateUnitsDto) {
    return this.rental.createUnitsBulk(dto);
  }

  @Get('units')
  listUnits(
    @Query('propertyId') propertyId?: string,
    @Query('status') status?: 'VACANT' | 'OCCUPIED',
  ) {
    return this.rental.listUnits({ propertyId, status });
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('units/:id')
  updateUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.rental.updateUnit(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.rental.createTenant(dto);
  }

  @Get('tenants')
  listTenants() {
    return this.rental.listTenants();
  }

  @Get('tenants/:id')
  getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.rental.getTenant(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('tenants/:id')
  updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.rental.updateTenant(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('leases')
  createLease(@Body() dto: CreateLeaseDto) {
    return this.rental.createLease(dto);
  }

  @Get('leases')
  listLeases(
    @Query('status') status?: 'ACTIVE' | 'ENDED',
    @Query('unitId') unitId?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.rental.listLeases({ status, unitId, tenantId });
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('leases/:id/end')
  endLease(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndLeaseDto) {
    return this.rental.endLease(id, dto);
  }

  // ── Rent, payments and statements (managers and owners only) ────────────

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('dues')
  dues() {
    return this.billing.dues();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('billing/generate')
  generateInvoices() {
    return this.billing.generateNow();
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('invoices')
  listInvoices(@Query('leaseId') leaseId?: string, @Query('open') open?: string) {
    return this.billing.listInvoices({ leaseId, onlyOpen: open === 'true' });
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('invoices')
  createCharge(@Body() dto: CreateChargeDto) {
    return this.billing.createCharge(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('payments')
  recordPayment(@Body() dto: RecordPaymentDto) {
    return this.billing.recordPayment(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('payments')
  listPayments(@Query('leaseId') leaseId?: string) {
    return this.billing.listPayments({ leaseId });
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('payments/:id')
  getReceipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getReceipt(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post('payments/:id/void')
  voidPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPaymentDto) {
    return this.billing.voidPayment(id, dto.reason);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Get('leases/:id/statement')
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.statement(id);
  }
}
