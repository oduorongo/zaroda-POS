import { PrismaClient, SalesAgentRole, SalesAgentStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { generateTempPassword } from "../src/common/crypto/temp-password";

/**
 * Demo marketing team: "Demo Sales Team" with a leader and a member who sign in at /team/login on the platform admin.
 * Safe to run again: it reuses the team and people and gives them fresh passwords (printed once, never stored readable).
 * The member is assigned the demo businesses that exist (Demo Retail Co, Uriri Builders Ltd) so their screens have data.
 */
const prisma = new PrismaClient();

const TEAM = "Demo Sales Team";
const PEOPLE = [
  { role: SalesAgentRole.LEADER, fullName: "Demo Team Leader", email: "leader.demo@zarodasolutions.app", phone: "+254700000101" },
  { role: SalesAgentRole.MEMBER, fullName: "Demo Team Member", email: "member.demo@zarodasolutions.app", phone: "+254700000102" },
];
const DEMO_BUSINESSES = ["Demo Retail Co", "Uriri Builders Ltd"];

async function main() {
  const team = await prisma.salesTeam.upsert({ where: { name: TEAM }, update: {}, create: { name: TEAM, region: "Nairobi" } });

  const logins: { role: string; email: string; password: string }[] = [];
  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const password = generateTempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    if (p.role === SalesAgentRole.LEADER) {
      await prisma.salesAgent.updateMany({
        where: { teamId: team.id, role: SalesAgentRole.LEADER, status: SalesAgentStatus.ACTIVE, email: { not: p.email } },
        data: { status: SalesAgentStatus.SUSPENDED },
      });
    }
    const agent = await prisma.salesAgent.upsert({
      where: { email: p.email },
      update: { teamId: team.id, role: p.role, fullName: p.fullName, phone: p.phone, passwordHash, mustChangePassword: false, status: SalesAgentStatus.ACTIVE },
      create: { teamId: team.id, role: p.role, fullName: p.fullName, email: p.email, phone: p.phone, passwordHash, mustChangePassword: false },
    });
    ids[p.role] = agent.id;
    logins.push({ role: p.role, email: p.email, password });
  }

  const orgs = await prisma.organization.findMany({ where: { name: { in: DEMO_BUSINESSES }, salesAgentId: null }, select: { id: true } });
  const assigned = { count: 0 };
  for (const org of orgs) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
      await tx.organization.update({ where: { id: org.id }, data: { salesTeamId: team.id, salesAgentId: ids[SalesAgentRole.MEMBER], salesAssignedAt: new Date() } });
    });
    assigned.count++;
  }

  console.log(`Team: ${TEAM}`);
  for (const l of logins) console.log(`${l.role.padEnd(6)} ${l.email}  password: ${l.password}`);
  console.log(`Demo businesses assigned to the member: ${assigned.count} (ones already assigned to someone are left alone)`);
  console.log("Sign in at the platform admin address + /team/login");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
