import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Demo tenant for local development: one org, one branch, one terminal,
 * one OWNER user. Login with owner@demo.zaroda.pos / password123 (dev only
 * - never used outside a local seed).
 */
async function main() {
  const org = await prisma.organization.create({
    data: { name: "Demo Retail Co", industryType: "RETAIL", country: "KE", baseCurrency: "KES" },
  });

  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Main Branch", county: "Nairobi" },
  });

  const terminal = await prisma.terminal.create({
    data: { branchId: branch.id, deviceLabel: "Register 1" },
  });

  const user = await prisma.user.create({
    data: {
      email: "owner@demo.zaroda.pos",
      passwordHash: await bcrypt.hash("password123", 10),
      pinHash: await bcrypt.hash("1234", 10),
      fullName: "Demo Owner",
    },
  });

  await prisma.orgUser.create({
    data: { organizationId: org.id, userId: user.id, role: Role.OWNER },
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
