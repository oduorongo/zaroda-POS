import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FarmRoleCode, FarmSpecies } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { FarmContext, hasFarmRole } from './farm-access';
import { addDays, asDate, dayOf, nextDue, todayKey, withdrawalUntil } from './farm-livestock.util';
import { CreateDrugDto, DueDoneDto, HealthEventDto, ProgrammeDto, VoidDto } from './dto/livestock.dto';

/** Only these may give a prescription-only drug. */
const PRESCRIBERS = [FarmRoleCode.VET, FarmRoleCode.FARM_MANAGER];

@Injectable()
export class FarmHealthService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private sees(farm: FarmContext, unitId: string | null) {
    if (farm.unitIds !== null && !(unitId && farm.unitIds.includes(unitId))) throw new ForbiddenException('That is outside the parts of the farm you work in.');
  }

  // ── Drugs ───────────────────────────────────────────────────────────────

  listDrugs() {
    return this.tenantPrisma.run((tx) => tx.farmDrug.findMany({ where: { active: true }, orderBy: { name: 'asc' } }));
  }

  createDrug(dto: CreateDrugDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const name = dto.name.trim();
      if (await tx.farmDrug.findFirst({ where: { active: true, name: { equals: name, mode: 'insensitive' } } })) throw new BadRequestException(`${name} is already on the list`);
      const drug = await tx.farmDrug.create({
        data: {
          organizationId,
          name,
          milkWithdrawalDays: dto.milkWithdrawalDays,
          meatWithdrawalDays: dto.meatWithdrawalDays,
          eggWithdrawalDays: dto.eggWithdrawalDays ?? 0,
          prescriptionOnly: dto.prescriptionOnly ?? false,
          notes: dto.notes?.trim() || null,
        },
      });
      await this.audit.logInTx(tx, { action: 'farm.drug_created', entityType: 'FarmDrug', entityId: drug.id, after: drug });
      return drug;
    });
  }

  /** Withdrawal days are never edited (past treatments keep theirs): a changed drug is retired and added again. */
  retireDrug(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.farmDrug.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Drug not found');
      const after = await tx.farmDrug.update({ where: { id }, data: { active: false } });
      await this.audit.logInTx(tx, { action: 'farm.drug_retired', entityType: 'FarmDrug', entityId: id, before, after });
      return after;
    });
  }

  // ── Health events ───────────────────────────────────────────────────────

  /** Sickness, treatment, vaccination, deworming, dipping or a check. A drug sets the milk/meat/egg withdrawal dates. */
  record(farm: FarmContext, dto: HealthEventDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      if (!!dto.animalId === !!dto.groupId) throw new BadRequestException('Choose one animal or one group');
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      const animal = dto.animalId ? await tx.farmAnimal.findUnique({ where: { id: dto.animalId } }) : null;
      const group = dto.groupId ? await tx.farmGroup.findUnique({ where: { id: dto.groupId } }) : null;
      const target = animal ?? group;
      if (!target) throw new NotFoundException(dto.animalId ? 'Animal not found' : 'Group not found');
      this.sees(farm, target.unitId);
      if (animal && animal.status !== 'ACTIVE') throw new BadRequestException(`${animal.tag} is no longer on the farm`);
      if (group && !group.active) throw new BadRequestException(`${group.name} is closed`);

      const drug = dto.drugId ? await tx.farmDrug.findUnique({ where: { id: dto.drugId } }) : null;
      if (dto.drugId && !drug) throw new BadRequestException('Drug not found');
      if (drug?.prescriptionOnly && !hasFarmRole(farm, PRESCRIBERS)) throw new ForbiddenException(`${drug.name} is prescription-only: the vet or farm manager records it.`);
      const programme = dto.programmeId ? await tx.farmProgramme.findUnique({ where: { id: dto.programmeId } }) : null;
      if (dto.programmeId && (!programme || programme.species !== target.species)) throw new BadRequestException('That programme is not for this animal');

      const event = await tx.farmHealthEvent.create({
        data: {
          organizationId,
          animalId: animal?.id ?? null,
          groupId: group?.id ?? null,
          date: asDate(dto.date),
          kind: dto.kind,
          diagnosis: dto.diagnosis?.trim() || null,
          drugId: drug?.id ?? null,
          dose: dto.dose?.trim() || null,
          byOrgUserId: orgUserId,
          vetName: dto.vetName?.trim() || null,
          cost: dto.cost ?? null,
          notes: dto.notes?.trim() || null,
          milkWithdrawalUntil: drug ? dateOrNull(withdrawalUntil(dto.date, drug.milkWithdrawalDays)) : null,
          meatWithdrawalUntil: drug ? dateOrNull(withdrawalUntil(dto.date, drug.meatWithdrawalDays)) : null,
          eggWithdrawalUntil: drug ? dateOrNull(withdrawalUntil(dto.date, drug.eggWithdrawalDays)) : null,
          programmeId: programme?.id ?? null,
        },
      });

      if (programme) {
        const who = animal ? { animalId: animal.id } : { groupId: group!.id };
        await tx.farmDueTask.updateMany({ where: { ...who, programmeId: programme.id, doneOn: null, cancelledAt: null }, data: { doneOn: asDate(dto.date) } });
        if (programme.active) {
          const due = nextDue(programme, { born: null, lastDone: dto.date }, todayKey());
          await tx.farmDueTask.create({ data: { organizationId, ...who, programmeId: programme.id, kind: programme.kind, title: taskTitle(programme.name, animal?.tag ?? group!.name), dueOn: asDate(due) } });
        }
      }
      await this.audit.logInTx(tx, { action: `farm.health_${dto.kind.toLowerCase()}`, entityType: 'FarmHealthEvent', entityId: event.id, after: event });
      return event;
    });
  }

  /** A wrong entry is voided with a reason (never deleted); its withdrawal no longer blocks sales. */
  voidEvent(farm: FarmContext, id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const e = await tx.farmHealthEvent.findUnique({ where: { id } });
      if (!e) throw new NotFoundException('Record not found');
      if (e.voidedAt) throw new BadRequestException('Already voided');
      if (e.drugId && !hasFarmRole(farm, PRESCRIBERS) && e.byOrgUserId !== getTenantStore().orgUserId) {
        throw new ForbiddenException('Only the vet, the farm manager or whoever recorded it can void a treatment.');
      }
      const target = e.animalId ? await tx.farmAnimal.findUnique({ where: { id: e.animalId } }) : await tx.farmGroup.findUnique({ where: { id: e.groupId! } });
      this.sees(farm, target?.unitId ?? null);
      const after = await tx.farmHealthEvent.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.health_voided', entityType: 'FarmHealthEvent', entityId: id, before: e, after });
      return after;
    });
  }

  /** Animals and groups whose milk, meat or eggs cannot be sold today. */
  withdrawals(farm: FarmContext) {
    return this.tenantPrisma.run(async (tx) => {
      const today = asDate(todayKey());
      const events = await tx.farmHealthEvent.findMany({
        where: { voidedAt: null, OR: [{ milkWithdrawalUntil: { gt: today } }, { meatWithdrawalUntil: { gt: today } }, { eggWithdrawalUntil: { gt: today } }] },
        orderBy: { date: 'desc' },
      });
      const [animals, groups, drugs] = await Promise.all([
        tx.farmAnimal.findMany({ where: { id: { in: ids(events.map((e) => e.animalId)) } }, select: { id: true, tag: true, name: true, unitId: true, status: true } }),
        tx.farmGroup.findMany({ where: { id: { in: ids(events.map((e) => e.groupId)) } }, select: { id: true, name: true, unitId: true, active: true } }),
        tx.farmDrug.findMany({ where: { id: { in: ids(events.map((e) => e.drugId)) } }, select: { id: true, name: true } }),
      ]);
      const a = new Map(animals.map((x) => [x.id, x]));
      const g = new Map(groups.map((x) => [x.id, x]));
      const d = new Map(drugs.map((x) => [x.id, x.name]));
      return events
        .map((e) => {
          const who = e.animalId ? a.get(e.animalId) : g.get(e.groupId!);
          if (!who || (e.animalId && (who as { status: string }).status !== 'ACTIVE') || (e.groupId && !(who as { active: boolean }).active)) return null;
          if (farm.unitIds !== null && !(who.unitId && farm.unitIds.includes(who.unitId))) return null;
          return {
            eventId: e.id,
            animalId: e.animalId,
            groupId: e.groupId,
            label: e.animalId ? [(who as { tag: string }).tag, (who as { name: string | null }).name].filter(Boolean).join(' ') : (who as { name: string }).name,
            drug: e.drugId ? d.get(e.drugId) ?? null : null,
            treatedOn: dayOf(e.date),
            milkUntil: e.milkWithdrawalUntil && e.milkWithdrawalUntil > today ? dayOf(e.milkWithdrawalUntil) : null,
            meatUntil: e.meatWithdrawalUntil && e.meatWithdrawalUntil > today ? dayOf(e.meatWithdrawalUntil) : null,
            eggUntil: e.eggWithdrawalUntil && e.eggWithdrawalUntil > today ? dayOf(e.eggWithdrawalUntil) : null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
    });
  }

  // ── Programmes ──────────────────────────────────────────────────────────

  listProgrammes() {
    return this.tenantPrisma.run((tx) => tx.farmProgramme.findMany({ where: { active: true }, orderBy: [{ species: 'asc' }, { name: 'asc' }] }));
  }

  /** A new programme schedules its first dose for every animal and group of that species already on the farm. */
  createProgramme(dto: ProgrammeDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      if (dto.drugId && !(await tx.farmDrug.findUnique({ where: { id: dto.drugId } }))) throw new BadRequestException('Drug not found');
      const p = await tx.farmProgramme.create({
        data: { organizationId, species: dto.species, name: dto.name.trim(), kind: dto.kind, drugId: dto.drugId ?? null, firstAgeDays: dto.firstAgeDays ?? null, intervalDays: dto.intervalDays },
      });
      const [animals, groups] = await Promise.all([
        tx.farmAnimal.findMany({ where: { species: dto.species, status: 'ACTIVE' }, select: { id: true, tag: true, birthDate: true } }),
        tx.farmGroup.findMany({ where: { species: dto.species, active: true }, select: { id: true, name: true, placedOn: true } }),
      ]);
      const today = todayKey();
      await tx.farmDueTask.createMany({
        data: [
          ...animals.map((a) => ({ organizationId, animalId: a.id, programmeId: p.id, kind: p.kind, title: taskTitle(p.name, a.tag), dueOn: asDate(nextDue(p, { born: a.birthDate ? dayOf(a.birthDate) : null, lastDone: null }, today)) })),
          ...groups.map((g) => ({ organizationId, groupId: g.id, programmeId: p.id, kind: p.kind, title: taskTitle(p.name, g.name), dueOn: asDate(nextDue(p, { born: dayOf(g.placedOn), lastDone: null }, today)) })),
        ],
      });
      await this.audit.logInTx(tx, { action: 'farm.programme_created', entityType: 'FarmProgramme', entityId: p.id, after: { ...p, scheduled: animals.length + groups.length } });
      return p;
    });
  }

  stopProgramme(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.farmProgramme.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Programme not found');
      const after = await tx.farmProgramme.update({ where: { id }, data: { active: false } });
      await tx.farmDueTask.updateMany({ where: { programmeId: id, doneOn: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'farm.programme_stopped', entityType: 'FarmProgramme', entityId: id, before, after });
      return after;
    });
  }

  /** Called when an animal or group joins the farm: its first dose of each programme for its species. */
  async scheduleFor(tx: TenantTx, t: { animalId?: string; groupId?: string; species: FarmSpecies; born: string | null }) {
    const { organizationId } = getTenantStore();
    const programmes = await tx.farmProgramme.findMany({ where: { species: t.species, active: true } });
    if (!programmes.length) return;
    const label = t.animalId
      ? (await tx.farmAnimal.findUniqueOrThrow({ where: { id: t.animalId }, select: { tag: true } })).tag
      : (await tx.farmGroup.findUniqueOrThrow({ where: { id: t.groupId! }, select: { name: true } })).name;
    const today = todayKey();
    await tx.farmDueTask.createMany({
      data: programmes.map((p) => ({
        organizationId,
        animalId: t.animalId ?? null,
        groupId: t.groupId ?? null,
        programmeId: p.id,
        kind: p.kind,
        title: taskTitle(p.name, label),
        dueOn: asDate(nextDue(p, { born: t.born, lastDone: null }, today)),
      })),
    });
  }

  // ── Due list ────────────────────────────────────────────────────────────

  /** What is due: overdue first, then the next `days` days. */
  due(farm: FarmContext, days = 30) {
    return this.tenantPrisma.run(async (tx) => {
      const tasks = await tx.farmDueTask.findMany({
        where: { doneOn: null, cancelledAt: null, dueOn: { lte: asDate(addDays(todayKey(), days)) } },
        orderBy: { dueOn: 'asc' },
        take: 500,
      });
      const [animals, groups] = await Promise.all([
        tx.farmAnimal.findMany({ where: { id: { in: ids(tasks.map((t) => t.animalId)) } }, select: { id: true, unitId: true } }),
        tx.farmGroup.findMany({ where: { id: { in: ids(tasks.map((t) => t.groupId)) } }, select: { id: true, unitId: true } }),
      ]);
      const unitOf = new Map([...animals, ...groups].map((x) => [x.id, x.unitId]));
      const today = todayKey();
      return tasks
        .filter((t) => farm.unitIds === null || farm.unitIds.includes(unitOf.get((t.animalId ?? t.groupId)!) ?? ''))
        .map((t) => ({ ...t, dueOn: dayOf(t.dueOn), overdue: dayOf(t.dueOn) < today }));
    });
  }

  /** Ticks off a task that is not a programme dose (drying off, a birth...); programme doses are done by recording the dose. */
  doneTask(farm: FarmContext, id: string, dto: DueDoneDto) {
    return this.tenantPrisma.run(async (tx) => {
      const t = await tx.farmDueTask.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Task not found');
      if (t.doneOn || t.cancelledAt) throw new BadRequestException('Already closed');
      if (t.programmeId) throw new BadRequestException('Record the dose (Health) to tick this off');
      const target = t.animalId ? await tx.farmAnimal.findUnique({ where: { id: t.animalId } }) : t.groupId ? await tx.farmGroup.findUnique({ where: { id: t.groupId } }) : null;
      this.sees(farm, target?.unitId ?? null);
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      const after = await tx.farmDueTask.update({ where: { id }, data: { doneOn: asDate(dto.date) } });
      await this.audit.logInTx(tx, { action: 'farm.task_done', entityType: 'FarmDueTask', entityId: id, before: t, after });
      return after;
    });
  }
}

const ids = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const dateOrNull = (day: string | null) => (day ? asDate(day) : null);
const taskTitle = (programme: string, who: string) => `${programme}: ${who}`;
