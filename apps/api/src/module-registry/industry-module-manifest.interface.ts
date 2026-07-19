import { Role } from '@prisma/client';

/**
 * The formal contract a vertical package implements to extend core without
 * core ever importing from it (DESIGN.md §3). Core depends on nothing here
 * except this interface; a module package depends on core types/services,
 * never the reverse.
 */
export interface IndustryModuleManifest {
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

export type CoreDomainEvent =
  | 'sale.beforeComplete'
  | 'sale.afterComplete'
  | 'inventory.beforeDecrement'
  | 'refund.afterApproved';
