import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PlatformAdminAuthGuard } from './platform-admin-auth.guard';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';
import { CreatePlanDto, UpdatePlanDto } from './dto/create-plan.dto';
import { OnboardTenantDto } from './dto/onboard-tenant.dto';
import { RecordPaymentDto, SetSuspensionDto } from './dto/record-payment.dto';
import { SetOnlineStoreAddonDto, SetOrganizationActiveDto, UpdateOrganizationDto } from './dto/update-organization.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { CommissionService } from '../online-store/commission.service';
import { RidersService } from '../riders/riders.service';
import { RentalPlatformPaymentsService } from '../rental/rental-platform-payments.service';
import { RentalListingAdminService } from '../rental/rental-listing-admin.service';
import { RoomBookingAutoCompleteService } from '../hotel/room-booking-autocomplete.service';
import { HospitalityAdminService } from '../hotel/hospitality-admin.service';
import { BlockHotelDto, BlockTableOrderingDto } from '../hotel/dto/hotel.dto';
import { BlockListingDto } from '../rental/dto/rental-listing.dto';
import { ListPlatformInvoicesQueryDto, RecordPlatformInvoicePaymentDto, WaivePlatformInvoiceDto } from '../rental/dto/rental-platform-invoice.dto';
import { ListRidersQueryDto, SetRiderStatusDto } from '../riders/dto/rider.dto';
import {
  GenerateInvoicesDto,
  ListInvoicesQueryDto,
  RecordInvoicePaymentDto,
  WaiveInvoiceDto,
} from './dto/commission.dto';

// Same throttle shape as tenant login (auth.controller.ts) - this is the
// one public, pre-JWT endpoint on this controller.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

interface PlatformAdminRequest extends Request {
  user?: { platformAdminId: string };
}

// Every route below @Public() + @UseGuards(PlatformAdminAuthGuard)
// explicitly, rather than relying on the app-wide JwtAuthGuard/RolesGuard
// (see PlatformAdminAuthGuard's own comment) - those two guards assume
// the tenant JWT payload shape (organizationId/role) and have no concept
// of a platform admin at all.
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly auth: PlatformAdminAuthService,
    private readonly platformAdmin: PlatformAdminService,
    private readonly auditLog: PlatformAuditLogService,
    private readonly commission: CommissionService,
    private readonly riders: RidersService,
    private readonly rentalBilling: RentalPlatformPaymentsService,
    private readonly listingAdmin: RentalListingAdminService,
    private readonly hotelStays: RoomBookingAutoCompleteService,
    private readonly hospitality: HospitalityAdminService,
  ) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('auth/login')
  login(@Body() dto: PlatformAdminLoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations')
  async listOrganizations(@Req() req: PlatformAdminRequest) {
    const result = await this.platformAdmin.listOrganizations();
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.listed_organizations',
      entityType: 'Organization',
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations/:id')
  async getOrganization(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.platformAdmin.getOrganization(id);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.viewed_organization',
      entityType: 'Organization',
      entityId: id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('tenants')
  async onboardTenant(
    @Req() req: PlatformAdminRequest,
    @Body() dto: OnboardTenantDto,
  ) {
    const result = await this.platformAdmin.onboardTenant(dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.onboarded_tenant',
      entityType: 'Organization',
      entityId: result.organizationId,
      organizationId: result.organizationId,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id')
  async updateOrganization(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    const result = await this.platformAdmin.updateOrganization(id, dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.updated_organization',
      entityType: 'Organization',
      entityId: id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/active')
  async setOrganizationActive(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOrganizationActiveDto,
  ) {
    const result = await this.platformAdmin.setOrganizationActive(id, dto.isActive);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: dto.isActive
        ? 'platform_admin.reactivated_organization'
        : 'platform_admin.deactivated_organization',
      entityType: 'Organization',
      entityId: id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/users/:orgUserId/reset-password')
  async resetUserPassword(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orgUserId', ParseUUIDPipe) orgUserId: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    const result = await this.platformAdmin.resetUserPassword(id, orgUserId, dto.newPassword);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.reset_user_password',
      entityType: 'OrgUser',
      entityId: orgUserId,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('plans')
  listPlans() {
    return this.platformAdmin.listPlans();
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('plans')
  async createPlan(
    @Req() req: PlatformAdminRequest,
    @Body() dto: CreatePlanDto,
  ) {
    const result = await this.platformAdmin.createPlan(dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.created_plan',
      entityType: 'Plan',
      entityId: result.id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('plans/:id')
  async updatePlan(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    const result = await this.platformAdmin.updatePlan(id, dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.updated_plan',
      entityType: 'Plan',
      entityId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/payments')
  async recordPayment(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    const result = await this.platformAdmin.recordPayment(
      id,
      dto,
      req.user!.platformAdminId,
    );
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.recorded_payment',
      entityType: 'Subscription',
      entityId: result.subscription.id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/suspension')
  async setSuspension(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSuspensionDto,
  ) {
    const result = await this.platformAdmin.setSuspension(id, dto.suspended);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: dto.suspended
        ? 'platform_admin.suspended_tenant'
        : 'platform_admin.reactivated_tenant',
      entityType: 'Subscription',
      entityId: result.id,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/online-store')
  async setOnlineStoreAddon(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOnlineStoreAddonDto,
  ) {
    const result = await this.platformAdmin.setOnlineStoreAddon(id, dto);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: dto.addonActive
        ? 'platform_admin.enabled_online_store'
        : 'platform_admin.disabled_online_store',
      entityType: 'OnlineStore',
      entityId: id,
      organizationId: id,
    });
    return result;
  }

  // ── Delivery riders ──────────────────────────────────────────────────

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('riders')
  listRiders(@Req() req: PlatformAdminRequest, @Query() query: ListRidersQueryDto) {
    return this.riders.listForAdmin(query.status);
  }

  // A new PIN for a rider who forgot theirs and cannot be texted. Shown once.
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('riders/:id/reset-pin')
  async resetRiderPin(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.riders.resetPinForAdmin(id);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.reset_rider_pin', entityType: 'Rider', entityId: id });
    return result;
  }

  // Approve (needs a finished profile) or suspend a rider.
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('riders/:id/status')
  async setRiderStatus(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRiderStatusDto) {
    const result = await this.riders.setStatusForAdmin(id, dto.status);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: dto.status === 'APPROVED' ? 'platform_admin.approved_rider' : 'platform_admin.suspended_rider',
      entityType: 'Rider',
      entityId: id,
    });
    return result;
  }

  // ── Online Shop commission ───────────────────────────────────────────

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('commission/invoices')
  listCommissionInvoices(@Query() query: ListInvoicesQueryDto) {
    return this.commission.listInvoices(query);
  }

  // Runs the whole daily automation on demand: invoices, emails, and
  // confirming payments. The scheduler does this by itself every hour -
  // this is for "do it now" and for a server where the scheduler is off.
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('commission/run')
  async runCommissionAutomation(@Req() req: PlatformAdminRequest) {
    const result = await this.commission.runAutomation();
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.ran_commission_billing',
      entityType: 'CommissionInvoice',
    });
    return result;
  }

  // Idempotent: creates invoices for finished months that don't have one
  // yet and never bills an order twice, so it's safe to run any time.
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('commission/generate')
  async generateCommissionInvoices(@Req() req: PlatformAdminRequest, @Body() dto: GenerateInvoicesDto) {
    const result = await this.commission.generateInvoices({ month: dto.month });
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.generated_commission_invoices',
      entityType: 'CommissionInvoice',
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/commission-invoices/:invoiceId/payment')
  async recordCommissionPayment(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: RecordInvoicePaymentDto,
  ) {
    const result = await this.commission.recordPayment(id, invoiceId, dto, req.user!.platformAdminId);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.recorded_commission_payment',
      entityType: 'CommissionInvoice',
      entityId: invoiceId,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/commission-invoices/:invoiceId/waive')
  async waiveCommissionInvoice(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: WaiveInvoiceDto,
  ) {
    const result = await this.commission.waive(id, invoiceId, dto.reason, req.user!.platformAdminId);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.waived_commission_invoice',
      entityType: 'CommissionInvoice',
      entityId: invoiceId,
      organizationId: id,
    });
    return result;
  }

  // ── Rental plan billing (what landlords owe Zaroda) ──────────────────

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('rental-billing/invoices')
  listRentalInvoices(@Query() query: ListPlatformInvoicesQueryDto) {
    return this.rentalBilling.listInvoices(query);
  }

  // Issues this month's invoices and any notices that are due, now. The scheduler does this by itself every hour.
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('rental-billing/run')
  async runRentalBilling(@Req() req: PlatformAdminRequest) {
    const result = await this.rentalBilling.runNow();
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.ran_rental_billing',
      entityType: 'RentalPlatformInvoice',
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/rental-invoices/:invoiceId/payment')
  async recordRentalInvoicePayment(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: RecordPlatformInvoicePaymentDto,
  ) {
    const result = await this.rentalBilling.recordPayment(id, invoiceId, dto, req.user!.platformAdminId);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.recorded_rental_invoice_payment',
      entityType: 'RentalPlatformInvoice',
      entityId: invoiceId,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/rental-invoices/:invoiceId/waive')
  async waiveRentalInvoice(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: WaivePlatformInvoiceDto,
  ) {
    const result = await this.rentalBilling.waive(id, invoiceId, dto.reason, req.user!.platformAdminId);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.waived_rental_invoice',
      entityType: 'RentalPlatformInvoice',
      entityId: invoiceId,
      organizationId: id,
    });
    return result;
  }

  // ── Restaurants and hotels: how bookings and table orders are going ──

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('hotel-overview')
  hotelOverview(@Query('days') days?: string) {
    return this.hospitality.hotels(Math.min(Math.max(Number.parseInt(days ?? '90', 10) || 90, 1), 365));
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('table-order-overview')
  tableOrderOverview(@Query('days') days?: string) {
    return this.hospitality.tableOrders(Math.min(Math.max(Number.parseInt(days ?? '30', 10) || 30, 1), 365));
  }

  // Takes a business's hotel rooms off the marketplace (and puts them back).
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/hotel/block')
  async blockHotel(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockHotelDto) {
    const result = await this.hospitality.blockHotel(id, dto.reason);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.took_hotel_off_marketplace', entityType: 'OnlineStore', organizationId: id });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/hotel/unblock')
  async unblockHotel(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.hospitality.unblockHotel(id);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.restored_hotel_to_marketplace', entityType: 'OnlineStore', organizationId: id });
    return result;
  }

  // Switches a business's table QR ordering off (and on again).
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/table-ordering/block')
  async blockTableOrdering(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockTableOrderingDto) {
    const result = await this.hospitality.blockTableOrdering(id, dto.reason);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.switched_off_table_ordering', entityType: 'OnlineStore', organizationId: id });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/table-ordering/unblock')
  async unblockTableOrdering(@Req() req: PlatformAdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.hospitality.unblockTableOrdering(id);
    await this.auditLog.log({ platformAdminId: req.user!.platformAdminId, action: 'platform_admin.switched_on_table_ordering', entityType: 'OnlineStore', organizationId: id });
    return result;
  }

  // Completes paid hotel stays whose check-out date is well past and nobody checked out, so their commission is billed.
  // The API does this by itself every hour; this is the "run it now".
  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('room-bookings/complete-overdue')
  async completeOverdueStays(@Req() req: PlatformAdminRequest) {
    const completed = await this.hotelStays.completeOverdue();
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.completed_overdue_hotel_stays',
      entityType: 'RoomBooking',
    });
    return { completed };
  }

  // ── Houses to let adverts (what landlords advertise, and what they paid for it) ──

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('rental-listings')
  listRentalListings() {
    return this.listingAdmin.list();
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/rental-listings/:listingId/block')
  async blockRentalListing(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: BlockListingDto,
  ) {
    const result = await this.listingAdmin.block(id, listingId, dto.reason);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.took_down_rental_listing',
      entityType: 'RentalListing',
      entityId: listingId,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Post('organizations/:id/rental-listings/:listingId/unblock')
  async unblockRentalListing(
    @Req() req: PlatformAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    const result = await this.listingAdmin.unblock(id, listingId);
    await this.auditLog.log({
      platformAdminId: req.user!.platformAdminId,
      action: 'platform_admin.restored_rental_listing',
      entityType: 'RentalListing',
      entityId: listingId,
      organizationId: id,
    });
    return result;
  }

  @Public()
  @UseGuards(PlatformAdminAuthGuard)
  @Get('analytics')
  analytics() {
    return this.platformAdmin.analytics();
  }
}
