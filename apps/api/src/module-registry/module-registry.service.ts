import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IndustryModuleManifest } from './industry-module-manifest.interface';

/**
 * Every vertical package calls register() with its manifest at bootstrap
 * (see CoreModule wiring in app.module.ts). Nothing here knows what a
 * "restaurant" or "pharmacy" is - it just holds manifests and wires their
 * declared hooks onto the shared event bus.
 *
 * Hooks are wired onto the event bus INSIDE register() itself, not in a
 * deferred OnModuleInit pass over already-registered manifests. That
 * deferred-pass version is what this originally was, and it had a real
 * ordering bug that went unnoticed until Phase 4 actually exercised it:
 * a calling module's own OnModuleInit (where it would naturally call
 * register()) runs AFTER this service's OnModuleInit, since Nest
 * initializes a module's dependencies before the module itself - so by
 * the time a module registered anything, this service's one-time wiring
 * pass had already run over an empty map and wired nothing. register()
 * doing the wiring itself removes the dependency on init order entirely.
 */
@Injectable()
export class ModuleRegistryService {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private readonly manifests = new Map<string, IndustryModuleManifest>();

  constructor(private readonly events: EventEmitter2) {}

  register(manifest: IndustryModuleManifest): void {
    if (this.manifests.has(manifest.industryType)) {
      throw new Error(
        `A module for industryType "${manifest.industryType}" is already registered`,
      );
    }
    this.manifests.set(manifest.industryType, manifest);
    for (const hook of manifest.hooks ?? []) {
      this.events.on(hook.event, hook.handler);
    }
    this.logger.log(`Registered module: ${manifest.industryType}`);
  }

  get(industryType: string): IndustryModuleManifest | undefined {
    return this.manifests.get(industryType);
  }

  getAll(): IndustryModuleManifest[] {
    return Array.from(this.manifests.values());
  }
}
