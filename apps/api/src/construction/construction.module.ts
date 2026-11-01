import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { OrgUsersModule } from '../org-users/org-users.module';
import { PrivateObjectStorageService } from '../common/storage/private-object-storage.service';
import { ConProjectGuard, ConstructionGuard } from './common/con-access';
import { ConSetupService } from './common/con-setup.service';
import { ComplianceAlertsService } from './compliance/compliance-alerts.service';
import { ComplianceService } from './compliance/compliance.service';
import { ConBillingCallbackController, ConPublicController, ConstructionController } from './construction.controller';
import { ConstructionService } from './construction.service';
import { ConLimitsListener } from './plans/con-limits.listener';
import { ConPlansService } from './plans/con-plans.service';
import { ConAddonsService } from './plans/con-addons.service';
import { ConUsageService } from './plans/con-usage.service';
import { BqService } from './projects/bq.service';
import { ProjectsController, TendersController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { TendersService } from './projects/tenders.service';
import { LabourService } from './site/labour.service';
import { SafetyService } from './site/safety.service';
import { SiteController } from './site/site.controller';
import { MaterialsController } from './materials/materials.controller';
import { CommercialController } from './commercial/commercial.controller';
import { CommercialService } from './commercial/commercial.service';
import { SubcontractsService } from './commercial/subcontracts.service';
import { MaterialsService } from './materials/materials.service';
import { PlantService } from './materials/plant.service';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SiteService } from './site/site.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MpesaB2cClient } from '../sales-teams/mpesa-b2c.client';
import { PayrollCallbackController, PayrollController } from './payroll/payroll.controller';
import { PayrollService } from './payroll/payroll.service';
import { ConPortalGuard } from './portal/portal-access';
import { PortalAuthService } from './portal/portal-auth.service';
import { PortalAuthController, PortalController, PortalUsersController } from './portal/portal.controller';
import { PortalService } from './portal/portal.service';
import { DashboardsService } from './reports/dashboards.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { ConApiKeyGuard } from './enterprise/api-key.guard';
import { ConstructionApiController, EnterpriseController } from './enterprise/enterprise.controller';
import { EnterpriseService } from './enterprise/enterprise.service';

/** Construction contractors (industryType "CONSTRUCTION", served at CONSTRUCTION_DOMAIN). See docs/construction. */
@Module({
  imports: [
    ModuleRegistryModule,
    OnlineStoreModule,
    OrgUsersModule,
    PurchasingModule,
    InventoryModule,
    // Portal tokens share the buyer secret and are told apart by their scope claim (see portal/portal-access.ts).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('BUYER_JWT_SECRET'), signOptions: { expiresIn: '12h' } }),
    }),
  ],
  controllers: [ConstructionController, TendersController, ProjectsController, SiteController, MaterialsController, CommercialController, PayrollController, PayrollCallbackController, PortalAuthController, PortalController, PortalUsersController, ReportsController, EnterpriseController, ConstructionApiController, ConBillingCallbackController, ConPublicController],
  providers: [
    ConSetupService,
    ConstructionGuard,
    ConProjectGuard,
    ConPlansService,
    ConAddonsService,
    ConUsageService,
    ConLimitsListener,
    ComplianceService,
    ComplianceAlertsService,
    ConstructionService,
    ProjectsService,
    TendersService,
    BqService,
    SiteService,
    LabourService,
    SafetyService,
    MaterialsService,
    PlantService,
    CommercialService,
    SubcontractsService,
    PayrollService,
    MpesaB2cClient,
    PortalAuthService,
    PortalService,
    ConPortalGuard,
    ReportsService,
    EnterpriseService,
    ConApiKeyGuard,
    DashboardsService,
    PrivateObjectStorageService,
  ],
  // Platform admin edits plans and coupons, extends trials and records payments.
  exports: [ConPlansService, ConAddonsService, ConSetupService, ComplianceAlertsService],
})
export class ConstructionModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'CONSTRUCTION',
      entityExtensions: [
        { tableName: 'con_plans', description: 'Construction price list: limits and features per plan (global)' },
        { tableName: 'con_coupons', description: 'Construction discount codes (global)' },
        { tableName: 'con_subscriptions', description: "A contractor's construction plan, trial and paid-up date" },
        { tableName: 'con_subscription_payments', description: 'Payments for the construction plan (M-Pesa or recorded by ZARODA)' },
        { tableName: 'con_roles', description: 'Construction roles with approval limits' },
        { tableName: 'con_user_roles', description: 'Company-level construction roles held by staff' },
        { tableName: 'con_project_members', description: 'Who works on which project, in which role' },
        { tableName: 'con_company_registrations', description: 'NCA registration per works class, with licence expiry' },
        { tableName: 'con_compliance_docs', description: 'Compliance vault documents with expiry dates and private files' },
        { tableName: 'con_category_limits', description: 'NCA category caps per works class' },
        { tableName: 'con_tax_settings', description: 'VAT, withholding, levies and retention rates with effective dates' },
        { tableName: 'con_alerts', description: 'In-app construction alerts (expiring documents)' },
        { tableName: 'con_settings', description: 'Construction rules: block or only warn' },
        { tableName: 'con_staff_accreditations', description: 'NCA accreditation cards held by staff' },
        { tableName: 'con_parties', description: 'Clients, consultants and subcontractors' },
        { tableName: 'con_tenders', description: 'Tender register with NCA cap check' },
        { tableName: 'con_projects', description: 'Projects and contracts' },
        { tableName: 'con_project_parties', description: 'Consultants and subcontractors on a project' },
        { tableName: 'con_project_permits', description: 'Project permit checklist (NCA, county, NEMA, DOSHS, occupancy)' },
        { tableName: 'con_milestones', description: 'Programme milestones with percent complete' },
        { tableName: 'con_bq_sections', description: 'Bill of Quantities sections' },
        { tableName: 'con_bq_items', description: 'Bill of Quantities items' },
        { tableName: 'con_site_diaries', description: 'Daily site diary, one per project per day' },
        { tableName: 'con_site_photos', description: 'Geo-tagged site photos (private files)' },
        { tableName: 'con_site_instructions', description: 'Site instructions from consultants' },
        { tableName: 'con_workers', description: 'Site workers with NCA accreditation cards' },
        { tableName: 'con_muster', description: 'Daily muster roll' },
        { tableName: 'con_toolbox_talks', description: 'Toolbox talks and who attended' },
        { tableName: 'con_ppe_issues', description: 'PPE issued to workers' },
        { tableName: 'con_permits_to_work', description: 'Permits to work (height, hot works, excavation...)' },
        { tableName: 'con_incidents', description: 'Incident register with DOSHS reporting' },
        { tableName: 'con_requisitions', description: 'Site material requisitions' },
        { tableName: 'con_requisition_lines', description: 'Materials asked for on a requisition' },
        { tableName: 'con_lpos', description: 'LPOs: approval and numbering on top of purchase orders to the project site' },
        { tableName: 'con_material_issues', description: 'Material issued from the site store to the works, or wasted' },
        { tableName: 'con_material_budgets', description: 'BQ allowance per material per project' },
        { tableName: 'con_plant', description: 'Plant and equipment register (owned or hired)' },
        { tableName: 'con_plant_logs', description: 'Daily plant hours and fuel per project' },
        { tableName: 'con_variations', description: 'Variations, linked to site instructions; approved ones change the revised sum' },
        { tableName: 'con_valuations', description: 'Interim valuations / IPCs (locked once certified; corrected by reversal)' },
        { tableName: 'con_valuation_lines', description: 'BQ items and variations measured to date on a valuation' },
        { tableName: 'con_valuation_receipts', description: 'Payments and withholding certificates against an IPC' },
        { tableName: 'con_retention_ledger', description: 'Retention deducted per IPC and released' },
        { tableName: 'con_subcontracts', description: 'Subcontracts on a project' },
        { tableName: 'con_sub_valuations', description: 'Subcontractor valuations, retention and payments' },
        { tableName: 'con_payroll_runs', description: 'Casual payroll runs per project and period, from the muster roll' },
        { tableName: 'con_payroll_lines', description: 'Pay, statutory deductions and payment per worker in a run' },
        { tableName: 'con_payout_settings', description: 'The business\x27s own M-Pesa B2C account for wages (secrets encrypted)' },
        { tableName: 'con_portal_users', description: 'Clients, consultants and subcontractors who use the portal (free)' },
        { tableName: 'con_portal_access', description: 'Which projects each portal user can see' },
        { tableName: 'con_payout_fee_bands', description: 'ZARODA fee per M-Pesa wage payout, by amount (global)' },
        { tableName: 'con_sms_bundles', description: 'SMS bundles on sale (global)' },
        { tableName: 'con_fee_charges', description: 'ZARODA fees owed by a business (M-Pesa wage payouts)' },
        { tableName: 'con_fee_invoices', description: 'Monthly ZARODA fee invoices, paid by M-Pesa' },
        { tableName: 'con_offices', description: 'Branch offices (Enterprise)' },
        { tableName: 'con_user_offices', description: 'Which office a staff member belongs to' },
        { tableName: 'con_custom_roles', description: 'Roles the Director makes from company jobs, with approval limits (Enterprise)' },
        { tableName: 'con_user_custom_roles', description: 'Custom roles held by staff' },
        { tableName: 'con_api_keys', description: 'Read-only API keys (hash only; Enterprise)' },
      ],
    });
  }
}
