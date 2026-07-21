import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * The ONLY way a PlatformAdmin row is ever created - there is
 * deliberately no HTTP endpoint for it (see PlatformAdminAuthService's
 * comment on why: a public "become a platform admin" endpoint would be a
 * severe vulnerability, since this identity can see every tenant).
 *
 * Run manually: PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_PASSWORD=...
 * PLATFORM_ADMIN_FULL_NAME=... pnpm --filter api seed:platform-admin
 *
 * Deliberately no fallback/default credentials, unlike prisma/seed.ts's
 * demo tenant (owner@demo.zaroda.pos/password123, fine for a throwaway
 * local demo org) - a platform admin account is a real credential with
 * real cross-tenant reach, so this refuses to run rather than silently
 * create one with a guessable password.
 */
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const fullName = process.env.PLATFORM_ADMIN_FULL_NAME;

  if (!email || !password || !fullName) {
    console.error(
      "Set PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD (min 8 chars), and PLATFORM_ADMIN_FULL_NAME first.",
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("PLATFORM_ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.platformAdmin.upsert({
    where: { email },
    create: { email, fullName, passwordHash },
    // Re-running with a new PLATFORM_ADMIN_PASSWORD rotates it - the
    // idempotent "safe to re-run" behavior every other seed/setup script
    // in this codebase already has.
    update: { fullName, passwordHash },
  });

  console.log(`Platform admin ready: ${admin.email} (${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
