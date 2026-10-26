import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { InventoryModule } from '../inventory/inventory.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { DocumentNumbersService } from './document-numbers.service';
import { SchoolAuthService } from './portal/school-auth.service';
import { SchoolJwtStrategy } from './portal/school-auth';
import {
  SchoolAuthController,
  SchoolPortalController,
} from './portal/school-portal.controller';
import { SchoolPortalService } from './portal/school-portal.service';
import { PriceListService } from './price-list.service';
import { SchoolBillingService } from './school-billing.service';
import { SchoolCollectionsService } from './school-collections.service';
import { SchoolWithholdingService } from './school-withholding.service';
import { SchoolRetentionService } from './school-retention.service';
import { SchoolBadDebtsService } from './school-bad-debts.service';
import { SchoolCashflowService } from './school-cashflow.service';
import { SchoolContractsService } from './school-contracts.service';
import { SchoolCreditNotesService } from './school-credit-notes.service';
import { SchoolLedgerService } from './school-ledger.service';
import { SchoolNotifierService } from './school-notifier.service';
import { SchoolOrdersService } from './school-orders.service';
import { SchoolQuotesService } from './school-quotes.service';
import { SchoolTendersController } from './school-tenders.controller';
import { SchoolTendersService } from './school-tenders.service';
import { SchoolSupplierController } from './school-supplier.controller';
import { SchoolsService } from './schools.service';

/**
 * Selling to schools on credit (industryType "SCHOOL_SUPPLIER"): a price list schools order from, orders the supplier
 * confirms and delivers with a delivery note and invoice, and part-payments with receipts. Like the rental module it
 * registers a manifest at bootstrap.
 */
@Module({
  imports: [
    ModuleRegistryModule,
    InventoryModule,
    PassportModule,
    // School tokens share the buyer secret and are told apart by their scope claim (see portal/school-auth.ts).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BUYER_JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('SCHOOL_JWT_EXPIRES_IN') ?? '30d',
        },
      }),
    }),
  ],
  controllers: [
    SchoolSupplierController,
    SchoolTendersController,
    SchoolAuthController,
    SchoolPortalController,
  ],
  providers: [
    DocumentNumbersService,
    SchoolLedgerService,
    SchoolNotifierService,
    SchoolsService,
    PriceListService,
    SchoolOrdersService,
    SchoolBillingService,
    SchoolCreditNotesService,
    SchoolContractsService,
    SchoolTendersService,
    SchoolCollectionsService,
    SchoolWithholdingService,
    SchoolRetentionService,
    SchoolBadDebtsService,
    SchoolCashflowService,
    SchoolQuotesService,
    SchoolAuthService,
    SchoolPortalService,
    SchoolJwtStrategy,
  ],
  exports: [SchoolOrdersService],
})
export class SchoolSupplierModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'SCHOOL_SUPPLIER',
      entityExtensions: [
        {
          tableName: 'school_portals',
          description:
            'The address (link name) schools use to sign in and order',
        },
        {
          tableName: 'supplier_schools',
          description:
            'Schools a supplier sells to on credit, with credit limit, credit days and portal sign-in',
        },
        {
          tableName: 'school_orders',
          description:
            'Orders schools place from the price list, confirmed and delivered by the supplier',
        },
        {
          tableName: 'school_order_lines',
          description:
            'Items on a school order, priced when the order is placed',
        },
        {
          tableName: 'supplier_invoices',
          description:
            "Invoices raised on delivery, due after the school's credit days",
        },
        {
          tableName: 'supplier_invoice_lines',
          description:
            'Items on an invoice, with the cost of the goods for the profit report',
        },
        {
          tableName: 'school_tenders',
          description:
            'Tenders the business bids for, with checklist, bid costing and the outcome',
        },
        {
          tableName: 'school_contracts',
          description:
            'Contracts to supply a school: value, variations, and the orders and invoices charged to them',
        },
        {
          tableName: 'school_quotes',
          description:
            'Price quotations to schools; accepted ones become orders at the quoted prices',
        },
        {
          tableName: 'supplier_credit_notes',
          description:
            'Credits to schools for goods returned, short deliveries and price corrections',
        },
        {
          tableName: 'supplier_payments',
          description:
            'Cheques, transfers and cash received from schools, with receipt numbers',
        },
        {
          tableName: 'supplier_payment_allocations',
          description: 'Which invoice each payment was applied to',
        },
        {
          tableName: 'document_counters',
          description:
            'Running numbers for orders, delivery notes, invoices and receipts',
        },
      ],
    });
  }
}
