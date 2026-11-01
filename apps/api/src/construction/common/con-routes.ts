import { RequestMethod, Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConRoleCode } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { CON_FEATURE_KEY, CON_ROLES_KEY, ConProjectGuard, ConstructionGuard } from './con-access';

export interface ConRoute { method: string; path: string; roles: ConRoleCode[] | null; feature: string | null; construction: boolean; project: boolean; isPublic: boolean }

/** Every route of the given controllers with its construction roles, plan feature and guards - for the permission tests. */
export function conRoutes(controllers: Type<unknown>[]): ConRoute[] {
  const out: ConRoute[] = [];
  for (const c of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, c) ?? '');
    const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, c) ?? [];
    for (const name of Object.getOwnPropertyNames(c.prototype)) {
      const fn = c.prototype[name];
      if (name === 'constructor' || typeof fn !== 'function' || Reflect.getMetadata(METHOD_METADATA, fn) === undefined) continue;
      const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? [])];
      const sub = String(Reflect.getMetadata(PATH_METADATA, fn) ?? '');
      out.push({
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod],
        path: `/${[base, sub].filter((p) => p && p !== '/').join('/')}`,
        roles: Reflect.getMetadata(CON_ROLES_KEY, fn) ?? Reflect.getMetadata(CON_ROLES_KEY, c) ?? null,
        feature: Reflect.getMetadata(CON_FEATURE_KEY, fn) ?? Reflect.getMetadata(CON_FEATURE_KEY, c) ?? null,
        construction: guards.includes(ConstructionGuard),
        project: guards.includes(ConProjectGuard),
        isPublic: !!(Reflect.getMetadata(IS_PUBLIC_KEY, fn) ?? Reflect.getMetadata(IS_PUBLIC_KEY, c)),
      });
    }
  }
  return out;
}
