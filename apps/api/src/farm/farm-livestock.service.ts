import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FarmAnimal, FarmGroup, FarmSpecies, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { FarmContext, upgradeError } from './farm-access';
import { FarmSetupService } from './farm-setup.service';
import { limitProblem } from './farm-plans.util';
import { DRY_OFF_DAYS, addDays, asDate, expectedBirth, limitOf, signedChange, todayKey, withdrawalState } from './farm-livestock.util';
import { BreedingEventDto, CreateAnimalDto, CreateGroupDto, ExitAnimalDto, GroupCountDto, UpdateAnimalDto, VoidDto, WeightDto } from './dto/livestock.dto';
import { FarmHealthService } from './farm-health.service';

const BREEDING_FEMALE_ONLY = ['SERVED', 'AI', 'PD_POSITIVE', 'PD_NEGATIVE', 'DRIED_OFF', 'BIRTH', 'ABORTION', 'HEAT'];

@Injectable()
export class FarmLivestockService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly setup: FarmSetupService,
    private readonly audit: AuditLogService,
    private readonly health: FarmHealthService,
  ) {}

  // ── Who sees what ───────────────────────────────────────────────────────

  /** A person limited to some units sees and records only animals/groups kept there. */
  static sees(farm: FarmContext, unitId: string | null): boolean {
    return farm.unitIds === null || (unitId !== null && farm.unitIds.includes(unitId));
  }
  private mustSee(farm: FarmContext, unitId: string | null) {
    if (!FarmLivestockService.sees(farm, unitId)) throw new ForbiddenException('That is outside the parts of the farm you work in.');
  }
  private seeFilter(farm: FarmContext): { unitId?: { in: string[] } } {
    return farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } };
  }

  /** Head (cattle, goats, sheep, pigs, rabbits) and birds (poultry) the farm keeps now. */
  static async counts(tx: TenantTx): Promise<{ head: number; birds: number }> {
    const [animals, groups] = await Promise.all([
      tx.farmAnimal.groupBy({ by: ['species'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
      tx.farmGroup.groupBy({ by: ['species'], where: { active: true }, _sum: { headCount: true } }),
    ]);
    const out = { head: 0, birds: 0 };
    for (const a of animals) {
      const k = limitOf(a.species);
      if (k) out[k] += a._count._all;
    }
    for (const g of groups) {
      const k = limitOf(g.species);
      if (k) out[k] += g._sum.headCount ?? 0;
    }
    return out;
  }

  private async checkLimit(tx: TenantTx, farm: FarmContext, species: FarmSpecies, extra: number) {
    const key = limitOf(species);
    if (!key || extra <= 0) return;
    const used = (await FarmLivestockService.counts(tx))[key];
    const problem = limitProblem(farm.plan, await this.setup.activePlans(), key, used, extra);
    if (problem) throw upgradeError(problem.message, { limit: key, requiredPlan: problem.requiredPlan });
  }

  private async checkPlace(tx: TenantTx, farm: FarmContext, d: { unitId?: string; enterpriseId?: string; groupId?: string }) {
    if (d.unitId) {
      if (!(await tx.farmUnit.findUnique({ where: { id: d.unitId } }))) throw new BadRequestException('That part of the farm was not found');
      this.mustSee(farm, d.unitId);
    }
    if (d.enterpriseId && !(await tx.farmEnterprise.findUnique({ where: { id: d.enterpriseId } }))) throw new BadRequestException('Enterprise not found');
    if (d.groupId && !(await tx.farmGroup.findUnique({ where: { id: d.groupId } }))) throw new BadRequestException('Group not found');
  }

  // ── Animals ─────────────────────────────────────────────────────────────

  listAnimals(farm: FarmContext, q: { status?: string; species?: string; search?: string }) {
    return this.tenantPrisma.run(async (tx) => {
      const where: Prisma.FarmAnimalWhereInput = {
        ...this.seeFilter(farm),
        status: q.status === 'ALL' ? undefined : q.status ? (q.status as FarmAnimal['status']) : 'ACTIVE',
        species: q.species ? (q.species as FarmSpecies) : undefined,
        ...(q.search?.trim()
          ? { OR: [{ tag: { contains: q.search.trim(), mode: 'insensitive' } }, { name: { contains: q.search.trim(), mode: 'insensitive' } }] }
          : {}),
      };
      const animals = await tx.farmAnimal.findMany({ where, orderBy: [{ species: 'asc' }, { tag: 'asc' }], take: 500 });
      const today = todayKey();
      const events = animals.length
        ? await tx.farmHealthEvent.findMany({
            where: {
              animalId: { in: animals.map((a) => a.id) },
              voidedAt: null,
              OR: [{ milkWithdrawalUntil: { gt: asDate(today) } }, { meatWithdrawalUntil: { gt: asDate(today) } }, { eggWithdrawalUntil: { gt: asDate(today) } }],
            },
          })
        : [];
      return animals.map((a) => ({ ...a, withdrawal: withdrawalState(events.filter((e) => e.animalId === a.id), today) }));
    });
  }

  getAnimal(farm: FarmContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const a = await tx.farmAnimal.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Animal not found');
      this.mustSee(farm, a.unitId);
      const [dam, sire, young, healthEvents, breeding, weights, due, unit] = await Promise.all([
        a.damId ? tx.farmAnimal.findUnique({ where: { id: a.damId }, select: { id: true, tag: true, name: true } }) : null,
        a.sireId ? tx.farmAnimal.findUnique({ where: { id: a.sireId }, select: { id: true, tag: true, name: true } }) : null,
        tx.farmAnimal.findMany({ where: { OR: [{ damId: id }, { sireId: id }] }, select: { id: true, tag: true, name: true, sex: true, birthDate: true, status: true }, orderBy: { birthDate: 'desc' } }),
        tx.farmHealthEvent.findMany({ where: { animalId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
        tx.farmBreedingEvent.findMany({ where: { animalId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
        tx.farmWeight.findMany({ where: { animalId: id }, orderBy: { date: 'desc' }, take: 50 }),
        tx.farmDueTask.findMany({ where: { animalId: id, doneOn: null, cancelledAt: null }, orderBy: { dueOn: 'asc' } }),
        a.unitId ? tx.farmUnit.findUnique({ where: { id: a.unitId }, select: { name: true } }) : null,
      ]);
      const drugs = await tx.farmDrug.findMany({ where: { id: { in: healthEvents.map((e) => e.drugId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      const drugName = new Map(drugs.map((d) => [d.id, d.name]));
      return {
        ...a,
        unitName: unit?.name ?? null,
        dam,
        sire,
        young,
        withdrawal: withdrawalState(healthEvents, todayKey()),
        health: healthEvents.map((e) => ({ ...e, drugName: e.drugId ? drugName.get(e.drugId) ?? null : null })),
        breeding,
        weights,
        due,
      };
    });
  }

  createAnimal(farm: FarmContext, dto: CreateAnimalDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const tag = dto.tag.trim();
      if (await tx.farmAnimal.findUnique({ where: { organizationId_tag: { organizationId, tag } } })) throw new ConflictException(`Tag ${tag} is already used on this farm`);
      await this.checkPlace(tx, farm, dto);
      for (const parent of [dto.damId, dto.sireId].filter((x): x is string => !!x)) {
        if (!(await tx.farmAnimal.findUnique({ where: { id: parent } }))) throw new BadRequestException('A parent animal was not found');
      }
      await this.checkLimit(tx, farm, dto.species, 1);
      const animal = await tx.farmAnimal.create({
        data: {
          organizationId,
          tag,
          name: dto.name?.trim() || null,
          species: dto.species,
          breed: dto.breed?.trim() || null,
          sex: dto.sex,
          birthDate: dto.birthDate ? asDate(dto.birthDate) : null,
          birthEstimated: dto.birthEstimated ?? false,
          damId: dto.damId ?? null,
          sireId: dto.sireId ?? null,
          sireCode: dto.sireCode?.trim() || null,
          source: dto.source ?? 'BOUGHT',
          boughtOn: dto.boughtOn ? asDate(dto.boughtOn) : null,
          boughtPrice: dto.boughtPrice ?? null,
          unitId: dto.unitId ?? null,
          enterpriseId: dto.enterpriseId ?? null,
          groupId: dto.groupId ?? null,
        },
      });
      await this.health.scheduleFor(tx, { animalId: animal.id, species: animal.species, born: dto.birthDate ?? null });
      await this.audit.logInTx(tx, { action: 'farm.animal_created', entityType: 'FarmAnimal', entityId: animal.id, after: animal });
      return animal;
    });
  }

  updateAnimal(farm: FarmContext, id: string, dto: UpdateAnimalDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.farmAnimal.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Animal not found');
      this.mustSee(farm, before.unitId);
      await this.checkPlace(tx, farm, dto);
      const after = await tx.farmAnimal.update({
        where: { id },
        data: {
          name: dto.name === undefined ? undefined : dto.name.trim() || null,
          breed: dto.breed === undefined ? undefined : dto.breed.trim() || null,
          unitId: dto.unitId,
          enterpriseId: dto.enterpriseId,
        },
      });
      await this.audit.logInTx(tx, {
        action: before.unitId !== after.unitId ? 'farm.animal_moved' : 'farm.animal_updated',
        entityType: 'FarmAnimal',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** Sold, died, slaughtered, culled or lost. Meat from an animal under withdrawal cannot be sold or slaughtered. */
  exitAnimal(farm: FarmContext, id: string, dto: ExitAnimalDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.farmAnimal.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Animal not found');
      this.mustSee(farm, before.unitId);
      if (before.status !== 'ACTIVE') throw new BadRequestException(`${before.tag} is already recorded as ${before.status.toLowerCase()}`);
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      if (dto.status === 'SOLD' || dto.status === 'SLAUGHTERED') {
        const w = withdrawalState(await tx.farmHealthEvent.findMany({ where: { animalId: id } }), dto.date);
        if (w.meatUntil) throw new BadRequestException(`${before.tag} was treated and its meat cannot be sold or eaten until after ${w.meatUntil}.`);
      }
      const after = await tx.farmAnimal.update({
        where: { id },
        data: {
          status: dto.status,
          statusDate: asDate(dto.date),
          statusNote: dto.note?.trim() || null,
          exitAmount: dto.amount ?? null,
          exitParty: dto.party?.trim() || null,
          permitNo: dto.permitNo?.trim() || null,
        },
      });
      await tx.farmDueTask.updateMany({ where: { animalId: id, doneOn: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
      await this.audit.logInTx(tx, { action: `farm.animal_${dto.status.toLowerCase()}`, entityType: 'FarmAnimal', entityId: id, before, after });
      return after;
    });
  }

  // ── Groups and flocks ───────────────────────────────────────────────────

  listGroups(farm: FarmContext, includeClosed = false) {
    return this.tenantPrisma.run(async (tx) => {
      const groups = await tx.farmGroup.findMany({ where: { ...this.seeFilter(farm), ...(includeClosed ? {} : { active: true }) }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
      const today = todayKey();
      const events = groups.length
        ? await tx.farmHealthEvent.findMany({
            where: {
              groupId: { in: groups.map((g) => g.id) },
              voidedAt: null,
              OR: [{ milkWithdrawalUntil: { gt: asDate(today) } }, { meatWithdrawalUntil: { gt: asDate(today) } }, { eggWithdrawalUntil: { gt: asDate(today) } }],
            },
          })
        : [];
      return groups.map((g) => ({ ...g, withdrawal: withdrawalState(events.filter((e) => e.groupId === g.id), today) }));
    });
  }

  getGroup(farm: FarmContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const g = await tx.farmGroup.findUnique({ where: { id } });
      if (!g) throw new NotFoundException('Group not found');
      this.mustSee(farm, g.unitId);
      const [counts, healthEvents, weights, due, unit] = await Promise.all([
        tx.farmGroupCount.findMany({ where: { groupId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
        tx.farmHealthEvent.findMany({ where: { groupId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
        tx.farmWeight.findMany({ where: { groupId: id }, orderBy: { date: 'desc' }, take: 50 }),
        tx.farmDueTask.findMany({ where: { groupId: id, doneOn: null, cancelledAt: null }, orderBy: { dueOn: 'asc' } }),
        g.unitId ? tx.farmUnit.findUnique({ where: { id: g.unitId }, select: { name: true } }) : null,
      ]);
      const drugs = await tx.farmDrug.findMany({ where: { id: { in: healthEvents.map((e) => e.drugId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      const drugName = new Map(drugs.map((d) => [d.id, d.name]));
      return {
        ...g,
        unitName: unit?.name ?? null,
        counts,
        withdrawal: withdrawalState(healthEvents, todayKey()),
        health: healthEvents.map((e) => ({ ...e, drugName: e.drugId ? drugName.get(e.drugId) ?? null : null })),
        weights,
        due,
      };
    });
  }

  createGroup(farm: FarmContext, dto: CreateGroupDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      await this.checkPlace(tx, farm, dto);
      if (dto.placedOn > todayKey()) throw new BadRequestException('The date cannot be in the future');
      await this.checkLimit(tx, farm, dto.species, dto.headCount);
      const group = await tx.farmGroup.create({
        data: {
          organizationId,
          species: dto.species,
          name: dto.name.trim(),
          breed: dto.breed?.trim() || null,
          purpose: dto.purpose?.trim() || null,
          placedOn: asDate(dto.placedOn),
          headCount: dto.headCount,
          unitId: dto.unitId ?? null,
          enterpriseId: dto.enterpriseId ?? null,
        },
      });
      if (dto.headCount > 0) {
        await tx.farmGroupCount.create({ data: { organizationId, groupId: group.id, date: asDate(dto.placedOn), change: dto.headCount, reason: 'PLACED', createdBy: orgUserId } });
      }
      await this.health.scheduleFor(tx, { groupId: group.id, species: group.species, born: dto.placedOn });
      await this.audit.logInTx(tx, { action: 'farm.group_created', entityType: 'FarmGroup', entityId: group.id, after: group });
      return group;
    });
  }

  /** A change in a group's head count: births, purchases, deaths, sales... The count never goes below zero. */
  changeCount(farm: FarmContext, id: string, dto: GroupCountDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const g = await tx.farmGroup.findUnique({ where: { id } });
      if (!g) throw new NotFoundException('Group not found');
      this.mustSee(farm, g.unitId);
      if (!g.active) throw new BadRequestException(`${g.name} is closed`);
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      const change = signedChange(dto.reason, dto.count);
      if (change === 0) throw new BadRequestException('Enter how many');
      if (g.headCount + change < 0) throw new BadRequestException(`${g.name} has only ${g.headCount}`);
      if (dto.reason === 'SOLD' || dto.reason === 'SLAUGHTERED') {
        const w = withdrawalState(await tx.farmHealthEvent.findMany({ where: { groupId: id } }), dto.date);
        if (w.meatUntil) throw new BadRequestException(`${g.name} was treated and its meat cannot be sold or eaten until after ${w.meatUntil}.`);
      }
      await this.checkLimit(tx, farm, g.species, change);
      await tx.farmGroupCount.create({
        data: { organizationId, groupId: id, date: asDate(dto.date), change, reason: dto.reason, note: dto.note?.trim() || null, amount: dto.amount ?? null, createdBy: orgUserId },
      });
      const after = await tx.farmGroup.update({ where: { id }, data: { headCount: { increment: change } } });
      await this.audit.logInTx(tx, { action: `farm.group_count_${dto.reason.toLowerCase()}`, entityType: 'FarmGroup', entityId: id, before: { headCount: g.headCount }, after: { headCount: after.headCount, change } });
      return after;
    });
  }

  closeGroup(farm: FarmContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const g = await tx.farmGroup.findUnique({ where: { id } });
      if (!g) throw new NotFoundException('Group not found');
      this.mustSee(farm, g.unitId);
      if (g.headCount > 0) throw new BadRequestException(`${g.name} still has ${g.headCount} - record where they went first`);
      const after = await tx.farmGroup.update({ where: { id }, data: { active: false } });
      await tx.farmDueTask.updateMany({ where: { groupId: id, doneOn: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'farm.group_closed', entityType: 'FarmGroup', entityId: id, before: g, after });
      return after;
    });
  }

  // ── Weights ─────────────────────────────────────────────────────────────

  private async target(tx: TenantTx, farm: FarmContext, t: { animalId?: string; groupId?: string }): Promise<{ animal: FarmAnimal | null; group: FarmGroup | null }> {
    if (!!t.animalId === !!t.groupId) throw new BadRequestException('Choose one animal or one group');
    const animal = t.animalId ? await tx.farmAnimal.findUnique({ where: { id: t.animalId } }) : null;
    const group = t.groupId ? await tx.farmGroup.findUnique({ where: { id: t.groupId } }) : null;
    if (!animal && !group) throw new NotFoundException(t.animalId ? 'Animal not found' : 'Group not found');
    this.mustSee(farm, (animal ?? group)!.unitId);
    return { animal, group };
  }

  addWeight(farm: FarmContext, dto: WeightDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      await this.target(tx, farm, dto);
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      return tx.farmWeight.create({
        data: { organizationId, animalId: dto.animalId ?? null, groupId: dto.groupId ?? null, date: asDate(dto.date), kg: dto.kg, bodyCondition: dto.bodyCondition ?? null },
      });
    });
  }

  // ── Breeding ────────────────────────────────────────────────────────────

  /**
   * Heat, service/AI (expected birth, and drying off for cows), pregnancy checks, drying off, births (the young are registered
   * from the mother and the last sire) and abortions.
   */
  recordBreeding(farm: FarmContext, dto: BreedingEventDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const mother = await tx.farmAnimal.findUnique({ where: { id: dto.animalId } });
      if (!mother) throw new NotFoundException('Animal not found');
      this.mustSee(farm, mother.unitId);
      if (mother.status !== 'ACTIVE') throw new BadRequestException(`${mother.tag} is no longer on the farm`);
      if (BREEDING_FEMALE_ONLY.includes(dto.kind) && mother.sex !== 'FEMALE') throw new BadRequestException(`${mother.tag} is not recorded as female`);
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      if (dto.sireId && !(await tx.farmAnimal.findUnique({ where: { id: dto.sireId } }))) throw new BadRequestException('Sire not found');

      const served = dto.kind === 'SERVED' || dto.kind === 'AI';
      const expected = served ? expectedBirth(mother.species, dto.date) : null;
      const event = await tx.farmBreedingEvent.create({
        data: {
          organizationId,
          animalId: mother.id,
          date: asDate(dto.date),
          kind: dto.kind,
          sireId: dto.sireId ?? null,
          sireCode: dto.sireCode?.trim() || null,
          inseminator: dto.inseminator?.trim() || null,
          expectedBirth: expected ? asDate(expected) : null,
          notes: dto.notes?.trim() || null,
        },
      });

      const open = (kind: string) => ({ animalId: mother.id, kind, doneOn: null, cancelledAt: null });
      if (served) {
        // A new service replaces any earlier expected birth or drying off still waiting.
        await tx.farmDueTask.updateMany({ where: { OR: [open('EXPECTED_BIRTH'), open('DRY_OFF')] }, data: { cancelledAt: new Date() } });
        if (expected) {
          await tx.farmDueTask.create({ data: { organizationId, animalId: mother.id, kind: 'EXPECTED_BIRTH', title: `${mother.tag} due to give birth`, dueOn: asDate(expected) } });
          if (mother.species === 'CATTLE') {
            const dry = addDays(expected, -DRY_OFF_DAYS);
            await tx.farmDueTask.create({ data: { organizationId, animalId: mother.id, kind: 'DRY_OFF', title: `Dry off ${mother.tag}`, dueOn: asDate(dry > todayKey() ? dry : todayKey()) } });
          }
        }
      } else if (dto.kind === 'PD_NEGATIVE' || dto.kind === 'ABORTION') {
        await tx.farmDueTask.updateMany({ where: { OR: [open('EXPECTED_BIRTH'), open('DRY_OFF')] }, data: { cancelledAt: new Date() } });
      } else if (dto.kind === 'DRIED_OFF') {
        await tx.farmDueTask.updateMany({ where: open('DRY_OFF'), data: { doneOn: asDate(dto.date) } });
      }

      let young: FarmAnimal[] = [];
      if (dto.kind === 'BIRTH') {
        await tx.farmDueTask.updateMany({ where: open('EXPECTED_BIRTH'), data: { doneOn: asDate(dto.date) } });
        await tx.farmDueTask.updateMany({ where: open('DRY_OFF'), data: { cancelledAt: new Date() } });
        const offspring = dto.offspring ?? [];
        if (offspring.length) {
          const lastService = await tx.farmBreedingEvent.findFirst({
            where: { animalId: mother.id, kind: { in: ['SERVED', 'AI'] }, voidedAt: null, date: { lte: asDate(dto.date) } },
            orderBy: { date: 'desc' },
          });
          const tags = offspring.map((o) => o.tag.trim());
          if (new Set(tags).size !== tags.length) throw new BadRequestException('Each young one needs its own tag');
          const taken = await tx.farmAnimal.findMany({ where: { tag: { in: tags } }, select: { tag: true } });
          if (taken.length) throw new ConflictException(`Tag ${taken.map((t) => t.tag).join(', ')} is already used on this farm`);
          await this.checkLimit(tx, farm, mother.species, offspring.length);
          for (const o of offspring) {
            const a = await tx.farmAnimal.create({
              data: {
                organizationId,
                tag: o.tag.trim(),
                name: o.name?.trim() || null,
                species: mother.species,
                breed: mother.breed,
                sex: o.sex,
                birthDate: asDate(dto.date),
                damId: mother.id,
                sireId: dto.sireId ?? lastService?.sireId ?? null,
                sireCode: dto.sireCode?.trim() || lastService?.sireCode || null,
                source: 'BORN',
                unitId: mother.unitId,
                enterpriseId: mother.enterpriseId,
              },
            });
            await this.health.scheduleFor(tx, { animalId: a.id, species: a.species, born: dto.date });
            young.push(a);
          }
        }
      }
      await this.audit.logInTx(tx, { action: `farm.breeding_${dto.kind.toLowerCase()}`, entityType: 'FarmBreedingEvent', entityId: event.id, after: { ...event, young: young.map((y) => y.tag) } });
      return { event, young };
    });
  }

  voidBreeding(farm: FarmContext, id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const e = await tx.farmBreedingEvent.findUnique({ where: { id } });
      if (!e) throw new NotFoundException('Record not found');
      const a = await tx.farmAnimal.findUnique({ where: { id: e.animalId } });
      this.mustSee(farm, a?.unitId ?? null);
      if (e.voidedAt) throw new BadRequestException('Already voided');
      if (e.kind === 'BIRTH') throw new BadRequestException('A birth cannot be voided here - record what happened to the young instead');
      const after = await tx.farmBreedingEvent.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      if (e.kind === 'SERVED' || e.kind === 'AI') {
        await tx.farmDueTask.updateMany({ where: { animalId: e.animalId, kind: { in: ['EXPECTED_BIRTH', 'DRY_OFF'] }, doneOn: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
      }
      await this.audit.logInTx(tx, { action: 'farm.breeding_voided', entityType: 'FarmBreedingEvent', entityId: id, before: e, after });
      return after;
    });
  }
}
