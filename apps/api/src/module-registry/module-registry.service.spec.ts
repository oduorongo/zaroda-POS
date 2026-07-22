import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModuleRegistryService } from './module-registry.service';
import { IndustryModuleManifest } from './industry-module-manifest.interface';

describe('ModuleRegistryService', () => {
  let service: ModuleRegistryService;

  beforeEach(() => {
    service = new ModuleRegistryService(new EventEmitter2());
  });

  function manifest(overrides: Partial<IndustryModuleManifest> = {}): IndustryModuleManifest {
    return { manifestVersion: 1, industryType: 'TEST_VERTICAL', ...overrides };
  }

  it('registers a manifest with a supported manifestVersion', () => {
    service.register(manifest());
    expect(service.get('TEST_VERTICAL')).toBeDefined();
  });

  it('rejects a manifest with an unrecognized manifestVersion', () => {
    expect(() => service.register(manifest({ manifestVersion: 999 }))).toThrow(
      /manifestVersion 999/,
    );
  });

  it('does not register a manifest that fails the version check', () => {
    try {
      service.register(manifest({ manifestVersion: 999 }));
    } catch {
      // expected
    }
    expect(service.get('TEST_VERTICAL')).toBeUndefined();
  });

  it('still rejects a duplicate industryType (existing behavior, unaffected by the version check)', () => {
    service.register(manifest());
    expect(() => service.register(manifest())).toThrow(/already registered/);
  });
});
