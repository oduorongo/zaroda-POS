import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PasswordChangedGuard } from './sales-agent-auth';
import { SalesPortalService } from './sales-portal.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TEAM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const member: any = { agentId: 'member-1', teamId: TEAM, role: 'MEMBER', mustChangePassword: false };
const leader: any = { agentId: 'leader-1', teamId: TEAM, role: 'LEADER', mustChangePassword: false };

function setup() {
  const tx: any = {
    $executeRaw: jest.fn(),
    sale: { count: jest.fn().mockResolvedValue(3), findFirst: jest.fn().mockResolvedValue({ createdAt: new Date('2026-10-01') }) },
    onlineStore: { findUnique: jest.fn().mockResolvedValue({ addonActive: true, isPublished: false }) },
    branch: { findFirst: jest.fn().mockResolvedValue({ county: 'Kisumu', subCounty: 'Kisumu Central' }) },
  };
  const prisma: any = {
    organization: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
    salesAgent: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    rider: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)),
  };
  const platformAdmin: any = { onboardTenant: jest.fn().mockResolvedValue({ organizationId: 'org-1', branchId: 'b', subscriptionId: 's' }) };
  const riders: any = { createForAgent: jest.fn().mockResolvedValue({ id: 'rider-1' }) };
  const teams: any = { addAgent: jest.fn().mockResolvedValue({}), setAgentStatus: jest.fn().mockResolvedValue({}), resetAgentPassword: jest.fn().mockResolvedValue({}) };
  return { service: new SalesPortalService(prisma, platformAdmin, riders, teams), prisma, platformAdmin, riders, teams, tx };
}

describe('SalesPortalService scoping', () => {
  it("a member sees only what they brought in, inside their own team", async () => {
    const { service, prisma } = setup();
    await service.listTenants(member);
    await service.listRiders(member);
    expect(prisma.organization.findMany.mock.calls[0][0].where).toEqual({ salesTeamId: TEAM, salesAgentId: 'member-1' });
    expect(prisma.rider.findMany.mock.calls[0][0].where).toEqual({ salesTeamId: TEAM, salesAgentId: 'member-1' });
  });

  it("a leader sees their whole team's work, and only their team's", async () => {
    const { service, prisma } = setup();
    await service.listTenants(leader);
    await service.listRiders(leader);
    expect(prisma.organization.findMany.mock.calls[0][0].where).toEqual({ salesTeamId: TEAM });
    expect(prisma.rider.findMany.mock.calls[0][0].where).toEqual({ salesTeamId: TEAM });
  });

  it('reads a shop\'s own details inside that shop\'s tenant context', async () => {
    const { service, prisma, tx } = setup();
    prisma.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Mama Mboga', industryType: 'RETAIL', isActive: true, createdAt: new Date(), salesAgentId: 'member-1' },
    ]);
    prisma.salesAgent.findMany.mockResolvedValue([{ id: 'member-1', fullName: 'Amina' }]);
    const [row] = await service.listTenants(member);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(row).toMatchObject({ name: 'Mama Mboga', county: 'Kisumu', saleCount: 3, onboardedBy: { fullName: 'Amina' }, onlineShop: { addonActive: true, isPublished: false } });
  });
});

describe('SalesPortalService.onboardTenant', () => {
  const dto: any = { organizationName: 'Mama Mboga', industryType: 'RETAIL', ownerFullName: 'Mama', ownerEmail: 'mama@example.com', branchName: 'Main' };

  it('credits the member and team, starts a free trial on the entry plan, and shows a made-up password once', async () => {
    const { service, platformAdmin } = setup();
    const result = await service.onboardTenant(member, dto);
    const [sent, options] = platformAdmin.onboardTenant.mock.calls[0];
    expect(options).toEqual({ attribution: { salesTeamId: TEAM, salesAgentId: 'member-1' }, trial: true });
    expect(sent.planTier).toBe('BASIC');
    expect(sent.ownerPassword).toHaveLength(12);
    expect(result.temporaryPassword).toBe(sent.ownerPassword);
  });

  it('does not echo back a password the member chose themselves', async () => {
    const { service } = setup();
    const result = await service.onboardTenant(member, { ...dto, ownerPassword: 'chosen-on-the-spot' });
    expect(result).not.toHaveProperty('temporaryPassword');
  });
});

describe('SalesPortalService.createRider', () => {
  it('credits the rider to the member and team', async () => {
    const { service, riders } = setup();
    await service.createRider(member, { email: 'r@example.com' } as any);
    expect(riders.createForAgent).toHaveBeenCalledWith({ email: 'r@example.com' }, { salesTeamId: TEAM, salesAgentId: 'member-1' });
  });
});

describe('SalesPortalService member management is for the leader only', () => {
  it('turns a member away from every management call', async () => {
    const { service, teams } = setup();
    await expect(service.listMembers(member)).rejects.toThrow(ForbiddenException);
    await expect(service.addMember(member, { fullName: 'X Y', email: 'x@example.com' })).rejects.toThrow(ForbiddenException);
    await expect(service.setMemberStatus(member, 'm-2', 'SUSPENDED' as any)).rejects.toThrow(ForbiddenException);
    await expect(service.resetMemberPassword(member, 'm-2')).rejects.toThrow(ForbiddenException);
    expect(teams.addAgent).not.toHaveBeenCalled();
  });

  it("a leader can only act on a MEMBER of their own team - someone else's is 'not found'", async () => {
    const { service, prisma, teams } = setup();
    prisma.salesAgent.findFirst.mockResolvedValue(null);
    await expect(service.setMemberStatus(leader, 'someone-elses', 'SUSPENDED' as any)).rejects.toThrow(NotFoundException);
    expect(prisma.salesAgent.findFirst.mock.calls[0][0].where).toEqual({ id: 'someone-elses', teamId: TEAM, role: 'MEMBER' });
    expect(teams.setAgentStatus).not.toHaveBeenCalled();
  });

  it('a leader adds a member to their own team, with no platform-admin audit entry', async () => {
    const { service, teams } = setup();
    await service.addMember(leader, { fullName: 'New Member', email: 'nm@example.com' });
    expect(teams.addAgent).toHaveBeenCalledWith(null, TEAM, 'MEMBER', { fullName: 'New Member', email: 'nm@example.com' });
  });

  it('a leader can reset their own member\'s password', async () => {
    const { service, prisma, teams } = setup();
    prisma.salesAgent.findFirst.mockResolvedValue({ id: 'm-2' });
    await service.resetMemberPassword(leader, 'm-2');
    expect(teams.resetAgentPassword).toHaveBeenCalledWith(null, 'm-2');
  });
});

describe('PasswordChangedGuard', () => {
  const context = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

  it('lets a person through once they have their own password', () => {
    expect(new PasswordChangedGuard().canActivate(context({ mustChangePassword: false }))).toBe(true);
  });

  it('holds back someone still on a temporary password', () => {
    expect(() => new PasswordChangedGuard().canActivate(context({ mustChangePassword: true }))).toThrow(ForbiddenException);
  });
});
