import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../src/common/prisma/tenant-scoped-prisma.service';
import { tenantContext } from '../src/common/tenant/tenant-context';

/**
 * Exercises the actual production isolation mechanism end-to-end against a
 * real Postgres, not a reimplementation of it: `appPrisma` below is the same
 * PrismaService + TenantScopedPrismaService pair every real request uses, so
 * this test only passes if the database this suite runs against actually has
 * rls.sql's policies applied AND the connection is the least-privilege
 * `zaroda_app` role (see prisma/README.md step 4) - a superuser/owner
 * connection bypasses RLS regardless of policy, which would make this suite
 * pass even with isolation completely broken. `ownerPrisma` (DIRECT_URL) is
 * used only to set up and tear down cross-tenant fixtures, since seeding two
 * tenants' data through RLS itself would be fighting the very thing under
 * test.
 *
 * Skips itself (rather than failing) when DATABASE_URL/DIRECT_URL aren't
 * set, so `pnpm test` (the fast, DB-less unit suite) is unaffected - this
 * file only runs under `pnpm test:e2e` / the dedicated CI job that
 * provisions Postgres, runs migrations, create-app-role.sql, and rls.sql
 * first (see .github/workflows/ci.yml).
 */
const hasDb = !!process.env.DATABASE_URL && !!process.env.DIRECT_URL;
const describeIfDb = hasDb ? describe : describe.skip;

// A remote Postgres round trip (this suite runs ~10 of them in beforeAll
// alone) comfortably exceeds Jest's 5s default hook timeout - and a timed-
// out beforeAll does NOT stop its still-running body, it just moves on
// with whatever fixture variables happened to be assigned so far. That
// previously left `afterAll` running cleanup with some fixture ids still
// `undefined`, which turned `prisma.user.deleteMany({ where: { id: undefined } })`
// into an **unfiltered delete matching every user row** - caught here only
// because a downstream Restrict FK (shifts.openedById) happened to block
// it before anything was actually lost. Never again: every hook below gets
// a timeout generous enough that this can't happen.
jest.setTimeout(30_000);

describeIfDb('Cross-tenant row-level security', () => {
  let ownerPrisma: PrismaClient;
  let prismaService: PrismaService;
  let tenantScoped: TenantScopedPrismaService;

  let orgA: string;
  let orgB: string;
  let branchA: string;
  let branchB: string;
  let variantA: string;
  let variantB: string;
  let recipeIngredientBId: string;
  let userA: string;
  let orgUserA: string;

  async function asTenant<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run(
      { organizationId, orgUserId: orgUserA, role: 'OWNER' as never },
      fn,
    );
  }

  beforeAll(async () => {
    ownerPrisma = new PrismaClient({
      datasources: { db: { url: process.env.DIRECT_URL } },
    });
    prismaService = new PrismaService();
    tenantScoped = new TenantScopedPrismaService(prismaService);
    await prismaService.onModuleInit();

    orgA = randomUUID();
    orgB = randomUUID();
    await ownerPrisma.organization.create({
      data: { id: orgA, name: `RLS test tenant A ${orgA}`, industryType: 'RETAIL' },
    });
    await ownerPrisma.organization.create({
      data: { id: orgB, name: `RLS test tenant B ${orgB}`, industryType: 'RETAIL' },
    });

    const branchAResult = await ownerPrisma.branch.create({
      data: { organizationId: orgA, name: 'Tenant A branch' },
    });
    branchA = branchAResult.id;
    const branchBResult = await ownerPrisma.branch.create({
      data: { organizationId: orgB, name: 'Tenant B branch' },
    });
    branchB = branchBResult.id;

    const productA = await ownerPrisma.product.create({
      data: { organizationId: orgA, name: 'Tenant A product' },
    });
    const variantAResult = await ownerPrisma.productVariant.create({
      data: { productId: productA.id, sku: 'RLS-A', price: 10 },
    });
    variantA = variantAResult.id;

    const productB = await ownerPrisma.product.create({
      data: { organizationId: orgB, name: 'Tenant B product' },
    });
    const variantBResult = await ownerPrisma.productVariant.create({
      data: { productId: productB.id, sku: 'RLS-B', price: 10 },
    });
    variantB = variantBResult.id;

    // A recipe_ingredients row for tenant B - scoped via variantId ->
    // product_variants.productId -> products.organizationId, the deepest
    // (2-hop EXISTS) RLS pattern in rls.sql, self-referential purely for
    // this test's convenience (the app layer separately forbids a variant
    // being its own ingredient - see RecipesService.set - but nothing stops
    // it at the database level, and the FK shape is all this test needs).
    const recipeIngredientB = await ownerPrisma.recipeIngredient.create({
      data: { variantId: variantB, ingredientVariantId: variantB, quantity: 1 },
    });
    recipeIngredientBId = recipeIngredientB.id;

    const user = await ownerPrisma.user.create({
      data: {
        email: `rls-test-${randomUUID()}@example.com`,
        passwordHash: 'x',
        fullName: 'RLS Test User',
      },
    });
    userA = user.id;
    const orgUser = await ownerPrisma.orgUser.create({
      data: { organizationId: orgA, userId: userA, role: 'OWNER' },
    });
    orgUserA = orgUser.id;
  });

  afterAll(async () => {
    // Every id is filtered through this guard before being used in a
    // deleteMany `where` - Prisma treats an `undefined` filter value as "no
    // constraint on this field," so a fixture id left unset by a partial
    // beforeAll failure would otherwise turn into an unfiltered delete
    // across the whole table (see jest.setTimeout's comment above for how
    // this actually happened once while writing this suite).
    const ids = [recipeIngredientBId, orgA, orgB, userA].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (ids.length < 4) {
      throw new Error(
        `Refusing to run cleanup - one or more fixture ids never got assigned (beforeAll likely failed partway): ${JSON.stringify({ recipeIngredientBId, orgA, orgB, userA })}`,
      );
    }

    // Delete children before parents where a Restrict FK would otherwise
    // block the parent's cascade (recipe_ingredients.ingredientVariantId is
    // onDelete: Restrict - see schema.prisma).
    await ownerPrisma.recipeIngredient.deleteMany({ where: { id: recipeIngredientBId } });
    await ownerPrisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await ownerPrisma.user.deleteMany({ where: { id: userA } });
    await ownerPrisma.$disconnect();
    await prismaService.onModuleDestroy();
  });

  it('cannot read another tenant\'s row via a direct organizationId column', async () => {
    const seenAsA = await asTenant(orgA, () =>
      tenantScoped.run((tx) => tx.branch.findUnique({ where: { id: branchB } })),
    );
    expect(seenAsA).toBeNull();

    const ownAsA = await asTenant(orgA, () =>
      tenantScoped.run((tx) => tx.branch.findUnique({ where: { id: branchA } })),
    );
    expect(ownAsA?.id).toBe(branchA);
  });

  it('cannot list another tenant\'s rows via a direct organizationId column', async () => {
    const productsAsA = await asTenant(orgA, () =>
      tenantScoped.run((tx) => tx.product.findMany({})),
    );
    expect(productsAsA.every((p) => p.organizationId === orgA)).toBe(true);
    expect(productsAsA.some((p) => p.organizationId === orgB)).toBe(false);
  });

  it('cannot write to another tenant\'s row via a direct organizationId column', async () => {
    await expect(
      asTenant(orgA, () =>
        tenantScoped.run((tx) =>
          tx.branch.update({ where: { id: branchB }, data: { name: 'hijacked' } }),
        ),
      ),
    ).rejects.toThrow();

    const stillIntact = await ownerPrisma.branch.findUnique({ where: { id: branchB } });
    expect(stillIntact?.name).toBe('Tenant B branch');
  });

  it('cannot read another tenant\'s row through a 2-hop EXISTS policy (recipe_ingredients -> product_variants -> products)', async () => {
    const seenAsA = await asTenant(orgA, () =>
      tenantScoped.run((tx) =>
        tx.recipeIngredient.findUnique({ where: { id: recipeIngredientBId } }),
      ),
    );
    expect(seenAsA).toBeNull();
  });

  it('organizations: a tenant can only ever see its own organization row by id', async () => {
    const ownOrg = await asTenant(orgA, () =>
      tenantScoped.run((tx) => tx.organization.findUnique({ where: { id: orgA } })),
    );
    expect(ownOrg?.id).toBe(orgA);

    const otherOrg = await asTenant(orgA, () =>
      tenantScoped.run((tx) => tx.organization.findUnique({ where: { id: orgB } })),
    );
    expect(otherOrg).toBeNull();
  });

  it('org_users: a write is still rejected with no tenant context established, despite the pre-tenant SELECT-widening exception', async () => {
    // The documented exception in rls.sql only ever widens SELECT, and only
    // when no tenant is set - WITH CHECK (governing INSERT/UPDATE) stays
    // strict regardless. Run against `prismaService` (the zaroda_app role
    // RLS actually applies to, not `ownerPrisma`'s BYPASSRLS connection)
    // with app.current_tenant explicitly RESET, bypassing
    // TenantScopedPrismaService (which always sets a tenant) so this test
    // controls session state precisely.
    await expect(
      prismaService.$transaction(async (tx) => {
        await tx.$executeRaw`RESET app.current_tenant`;
        await tx.$executeRaw`INSERT INTO org_users ("id", "organizationId", "userId", "role") VALUES (${randomUUID()}, ${orgA}, ${userA}, 'OWNER'::"Role")`;
      }),
    ).rejects.toThrow();
  });
});
