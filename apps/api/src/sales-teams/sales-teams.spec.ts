import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { generateTempPassword } from '../common/crypto/temp-password';
import { SalesAgentJwtStrategy } from './sales-agent-auth';
import { SalesAgentService } from './sales-agent.service';
import { SalesTeamsService } from './sales-teams.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TEAM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const agentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  teamId: TEAM,
  role: 'MEMBER',
  fullName: 'Amina Otieno',
  email: 'amina@example.com',
  phone: null,
  passwordHash: bcrypt.hashSync('right-password', 4),
  mustChangePassword: true,
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const teamRow = (overrides: Record<string, unknown> = {}) => ({
  id: TEAM,
  name: 'Western Team',
  region: 'Kisumu',
  status: 'ACTIVE',
  memberShareRate: 0.3,
  leaderOverrideRate: 0.05,
  onboardingBonusKes: 500,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function teamsSetup() {
  const tx: any = {
    salesAgent: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), create: jest.fn().mockImplementation(({ data }) => Promise.resolve(agentRow(data))) },
  };
  const prisma: any = {
    salesTeam: { findUnique: jest.fn().mockResolvedValue(teamRow()), create: jest.fn().mockImplementation(({ data }) => Promise.resolve(teamRow(data))), update: jest.fn() },
    salesAgent: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockImplementation(({ data }) => Promise.resolve(agentRow(data))) },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)),
  };
  return { service: new SalesTeamsService(prisma), prisma, tx };
}

describe('generateTempPassword', () => {
  it('is 12 characters, avoids look-alike characters, and differs each time', () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a).toHaveLength(12);
    expect(a).not.toMatch(/[01OIl]/);
    expect(a).not.toBe(b);
  });
});

describe('SalesTeamsService.createTeam', () => {
  it('refuses terms that pay out more than Zaroda collects', async () => {
    const { service } = teamsSetup();
    await expect(service.createTeam(ADMIN, { name: 'X Team', memberShareRate: 0.8, leaderOverrideRate: 0.3 })).rejects.toThrow(BadRequestException);
  });

  it('creates a team with zero rates by default and logs it', async () => {
    const { service, prisma } = teamsSetup();
    await service.createTeam(ADMIN, { name: ' Coast Team ' });
    expect(prisma.salesTeam.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Coast Team', memberShareRate: 0, leaderOverrideRate: 0, onboardingBonusKes: 0 }) });
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'sales_team.create', platformAdminId: ADMIN }) });
  });
});

describe('SalesTeamsService.addAgent', () => {
  it('refuses an email that already has an account', async () => {
    const { service, prisma } = teamsSetup();
    prisma.salesAgent.findUnique.mockResolvedValue(agentRow());
    await expect(service.addAgent(ADMIN, TEAM, 'MEMBER' as any, { fullName: 'A B', email: 'AMINA@example.com' })).rejects.toThrow(ConflictException);
  });

  it('returns a temporary password once, and stores only its hash', async () => {
    const { service, tx } = teamsSetup();
    const result = await service.addAgent(ADMIN, TEAM, 'MEMBER' as any, { fullName: 'New Person', email: ' New@Example.com ' });
    const stored = tx.salesAgent.create.mock.calls[0][0].data;
    expect(stored.email).toBe('new@example.com');
    expect(stored.passwordHash).not.toBe(result.temporaryPassword);
    expect(await bcrypt.compare(result.temporaryPassword, stored.passwordHash)).toBe(true);
    expect(JSON.stringify(result.agent)).not.toContain('passwordHash');
  });

  it('keeps one active leader per team unless told to replace them', async () => {
    const { service, tx } = teamsSetup();
    tx.salesAgent.findFirst.mockResolvedValue(agentRow({ id: 'old-leader', role: 'LEADER', fullName: 'Old Leader' }));
    await expect(service.addAgent(ADMIN, TEAM, 'LEADER' as any, { fullName: 'New Leader', email: 'nl@example.com' })).rejects.toThrow(/already this team's leader/);
    expect(tx.salesAgent.create).not.toHaveBeenCalled();

    await service.addAgent(ADMIN, TEAM, 'LEADER' as any, { fullName: 'New Leader', email: 'nl@example.com', replaceExistingLeader: true });
    expect(tx.salesAgent.update).toHaveBeenCalledWith({ where: { id: 'old-leader' }, data: { status: 'SUSPENDED' } });
    expect(tx.salesAgent.create).toHaveBeenCalled();
  });
});

describe('SalesTeamsService.setAgentStatus', () => {
  it('will not reactivate a leader while the team has another active leader', async () => {
    const { service, prisma } = teamsSetup();
    prisma.salesAgent.findUnique.mockResolvedValue(agentRow({ role: 'LEADER', status: 'SUSPENDED' }));
    prisma.salesAgent.findFirst.mockResolvedValue(agentRow({ id: 'other', role: 'LEADER', fullName: 'Current Leader' }));
    await expect(service.setAgentStatus(ADMIN, 'agent-1', 'ACTIVE' as any)).rejects.toThrow(ConflictException);
  });
});

describe('SalesTeamsService.resetAgentPassword', () => {
  it('issues a new temporary password and forces a change', async () => {
    const { service, prisma } = teamsSetup();
    prisma.salesAgent.findUnique.mockResolvedValue(agentRow());
    const result = await service.resetAgentPassword(ADMIN, 'agent-1');
    const data = prisma.salesAgent.update.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(true);
    expect(await bcrypt.compare(result.temporaryPassword, data.passwordHash)).toBe(true);
  });
});

function agentSetup(agent: Record<string, unknown> | null, teamStatus = 'ACTIVE') {
  const prisma: any = {
    salesAgent: {
      findUnique: jest.fn().mockResolvedValue(agent ? { ...agent, team: teamRow({ status: teamStatus }) } : null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const jwt: any = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  return { service: new SalesAgentService(prisma, jwt), prisma, jwt };
}

describe('SalesAgentService.login', () => {
  it('signs in with the right password and returns a token with the sales-agent scope', async () => {
    const { service, jwt } = agentSetup(agentRow());
    const result = await service.login({ email: 'Amina@Example.com', password: 'right-password' });
    expect(result.accessToken).toBe('signed-token');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'agent-1', scope: 'sales-agent' });
    expect(result.agent.mustChangePassword).toBe(true);
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = agentSetup(agentRow());
    const unknownEmail = agentSetup(null);
    await expect(wrongPassword.service.login({ email: 'amina@example.com', password: 'nope' })).rejects.toThrow('Invalid email or password');
    await expect(unknownEmail.service.login({ email: 'ghost@example.com', password: 'nope' })).rejects.toThrow('Invalid email or password');
  });

  it('turns away a suspended person, and anyone on a paused team, even with the right password', async () => {
    await expect(agentSetup(agentRow({ status: 'SUSPENDED' })).service.login({ email: 'amina@example.com', password: 'right-password' })).rejects.toThrow(/suspended/);
    await expect(agentSetup(agentRow(), 'PAUSED').service.login({ email: 'amina@example.com', password: 'right-password' })).rejects.toThrow(/paused/);
  });
});

describe('SalesAgentService.changePassword', () => {
  it('needs the current password', async () => {
    const { service } = agentSetup(agentRow());
    await expect(service.changePassword('agent-1', { currentPassword: 'wrong', newPassword: 'a-new-password' })).rejects.toThrow(BadRequestException);
  });

  it('rejects reusing the current password', async () => {
    const { service } = agentSetup(agentRow());
    await expect(service.changePassword('agent-1', { currentPassword: 'right-password', newPassword: 'right-password' })).rejects.toThrow(/different/);
  });

  it('saves the new one hashed and clears the must-change flag', async () => {
    const { service, prisma } = agentSetup(agentRow());
    await service.changePassword('agent-1', { currentPassword: 'right-password', newPassword: 'a-new-password' });
    const data = prisma.salesAgent.update.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(false);
    expect(await bcrypt.compare('a-new-password', data.passwordHash)).toBe(true);
  });
});

describe('SalesAgentJwtStrategy', () => {
  const strategy = (agent: Record<string, unknown> | null) => {
    const prisma: any = { salesAgent: { findUnique: jest.fn().mockResolvedValue(agent) } };
    const config: any = { getOrThrow: () => 'test-secret' };
    return new SalesAgentJwtStrategy(config, prisma);
  };

  it('accepts an active person on an active team', async () => {
    const s = strategy({ id: 'agent-1', teamId: TEAM, role: 'LEADER', status: 'ACTIVE', mustChangePassword: false, team: { status: 'ACTIVE' } });
    await expect(s.validate({ sub: 'agent-1', scope: 'sales-agent' })).resolves.toEqual({ agentId: 'agent-1', teamId: TEAM, role: 'LEADER', mustChangePassword: false });
  });

  it('refuses a token with another scope (a rider or shopper token)', async () => {
    const s = strategy({ id: 'agent-1', teamId: TEAM, role: 'MEMBER', status: 'ACTIVE', team: { status: 'ACTIVE' } });
    await expect(s.validate({ sub: 'agent-1', scope: 'rider' } as any)).resolves.toBe(false);
  });

  it('cuts off a person who was suspended after their token was issued', async () => {
    const s = strategy({ id: 'agent-1', teamId: TEAM, role: 'MEMBER', status: 'SUSPENDED', team: { status: 'ACTIVE' } });
    await expect(s.validate({ sub: 'agent-1', scope: 'sales-agent' })).resolves.toBe(false);
  });

  it('cuts off everyone on a paused team', async () => {
    const s = strategy({ id: 'agent-1', teamId: TEAM, role: 'MEMBER', status: 'ACTIVE', team: { status: 'PAUSED' } });
    await expect(s.validate({ sub: 'agent-1', scope: 'sales-agent' })).resolves.toBe(false);
  });
});
