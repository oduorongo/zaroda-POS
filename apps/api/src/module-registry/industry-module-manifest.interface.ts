import { Role } from '@prisma/client';

/**
 * The formal contract a vertical package implements to extend core without
 * core ever importing from it (DESIGN.md §3). Core depends on nothing here
 * except this interface; a module package depends on core types/services,
 * never the reverse.
 */
export interface IndustryModuleManifest {
  /**
   * Which shape of this contract the manifest was written against -
   * checked by ModuleRegistryService.register() against
   * SUPPORTED_MANIFEST_VERSIONS before anything else runs. Existing
   * fields are stable at version 1; if a future change needs to remove or
   * repurpose a field (not just add an optional one - additive changes
   * never need a bump), bump this and update
   * SUPPORTED_MANIFEST_VERSIONS so an older, unmigrated vertical package
   * fails loudly and specifically at registration time instead of either
   * crashing somewhere unrelated later or silently misbehaving.
   */
  manifestVersion: number;

  /** Matches Organization.industryType, e.g. "RETAIL" | "RESTAURANT" | "PHARMACY" | "SALON". */
  industryType: string;

  /**
   * Additional fields a sale needs for this vertical. Prefer a dedicated
   * 1:1 extension table (e.g. restaurant_sale_details) over JSONB for
   * anything reported on or queried - JSONB is for flexible, rarely-queried
   * metadata only.
   */
  transactionExtensions?: {
    tableName: string;
  };

  /** New first-class entities this module owns outright (tables, appointments, kitchen tickets, prescriptions...). */
  entityExtensions?: {
    tableName: string;
    description: string;
  }[];

  /** Terminal PWA panels this module contributes, keyed by org.industryType so the terminal only mounts what's relevant. */
  uiPanels?: {
    id: string;
    mountPoint: 'pos-main' | 'pos-sidebar' | 'backoffice';
  }[];

  /** Report definitions this module contributes to the core reporting module. */
  reports?: {
    id: string;
    label: string;
    requiredRole: Role;
  }[];

  /**
   * Subscribers to core domain events. In-process for the modular monolith
   * (wired via @nestjs/event-emitter), but shaped like external subscribers
   * so a later split into a separate service changes transport only, never
   * this contract.
   */
  hooks?: {
    event: CoreDomainEvent;
    handler: (payload: unknown) => Promise<void>;
  }[];
}

// All four were declared here from the start (Phase 0), but until a
// Phase 3 hardening pass, core never actually called emit() for any of
// them - the whole hook mechanism was registered but non-functional. All
// four are now genuinely wired and emitAsync-awaited so a hook can veto
// by throwing: sale.beforeComplete/afterComplete
// (SalesService.create()), inventory.beforeDecrement
// (InventoryTransactionsService.recordInTx), and refund.afterApproved
// (SalesService.refund() - the Refund Prisma model existed since Phase 0
// with no API to create one until that method was added).
export type CoreDomainEvent =
  | 'sale.beforeComplete'
  | 'sale.afterComplete'
  | 'inventory.beforeDecrement'
  | 'refund.afterApproved';
