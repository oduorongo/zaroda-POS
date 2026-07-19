import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

/**
 * Demo tenant for local development: one org, one branch, one terminal,
 * one OWNER user. Login with owner@demo.zaroda.pos / password123 (dev only
 * - never used outside a local seed).
 *
 * Creating a brand-new organization is a genuine bootstrap case for RLS
 * (prisma/rls.sql FORCE ROW LEVEL SECURITY applies even to the connecting
 * role, which owns these tables but isn't exempt): you can't SET the tenant
 * to an org that doesn't exist yet. Fix: generate the id client-side and
 * establish it as the tenant in the same transaction as the very first
 * insert, so every row's WITH CHECK (id/organizationId = current tenant)
 * is satisfied from the start.
 */
async function main() {
  const orgId = randomUUID();

  const { org, branch, terminal, user } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${orgId}, true)`;

    const org = await tx.organization.create({
      data: { id: orgId, name: "Demo Retail Co", industryType: "RETAIL", country: "KE", baseCurrency: "KES" },
    });

    const branch = await tx.branch.create({
      data: { organizationId: org.id, name: "Main Branch", county: "Nairobi" },
    });

    const terminal = await tx.terminal.create({
      data: { branchId: branch.id, deviceLabel: "Register 1" },
    });

    const user = await tx.user.create({
      data: {
        email: "owner@demo.zaroda.pos",
        passwordHash: await bcrypt.hash("password123", 10),
        pinHash: await bcrypt.hash("1234", 10),
        fullName: "Demo Owner",
      },
    });

    await tx.orgUser.create({
      data: { organizationId: org.id, userId: user.id, role: Role.OWNER },
    });

    return { org, branch, terminal, user };
  });

  console.log("Seeded demo tenant:");
  console.log({ organizationId: org.id, branchId: branch.id, terminalId: terminal.id, userId: user.id });
  console.log("Login: owner@demo.zaroda.pos / password123");
  console.log("PIN login (once you have an orgUserId): 1234");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
