import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IndustryModuleManifest } from './industry-module-manifest.interface';

/**
 * Every vertical package calls register() with its manifest at bootstrap
 * (see CoreModule wiring in app.module.ts). Nothing here knows what a
 * "restaurant" or "pharmacy" is - it just holds manifests and wires their
 * declared hooks onto the shared event bus.
 */
@Injectable()
export class ModuleRegistryService implements OnModuleInit {
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
  }

  get(industryType: string): IndustryModuleManifest | undefined {
    return this.manifests.get(industryType);
  }

  getAll(): IndustryModuleManifest[] {
    return Array.from(this.manifests.values());
  }

  onModuleInit() {
    for (const manifest of this.manifests.values()) {
      for (const hook of manifest.hooks ?? []) {
        this.events.on(hook.event, hook.handler);
      }
      this.logger.log(`Registered module: ${manifest.industryType}`);
    }
  }
}
