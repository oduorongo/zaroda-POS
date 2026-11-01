import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext } from '../common/con-access';
import { SendMessageDto } from '../dto/messages.dto';

const LIST = 100;
const snippet = (s: string) => (s.length > 140 ? `${s.slice(0, 140)}...` : s);

/**
 * In-app messages between the people of a construction company: to chosen people, a project's team or everyone; replies go to everyone
 * in the conversation. Each person has their own copy with its read time, which drives the bell's unread count.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private names(tx: TenantTx, ids: string[]) {
    return tx.orgUser
      .findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, user: { select: { fullName: true } } } })
      .then((rows) => new Map(rows.map((r) => [r.id, r.user.fullName])));
  }

  /** The projects this person can message a team on: all open ones for company staff, otherwise their own. */
  private visibleProjects(tx: TenantTx, con: ConContext) {
    const own = con.isOwner || con.companyRoles.length > 0;
    return tx.conProject.findMany({
      where: { status: { not: 'CLOSED' }, ...(own ? {} : { id: { in: con.projectRoles.map((r) => r.projectId) } }) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Who can be messaged: active staff (not yourself), and the projects whose team you can message. */
  recipients(con: ConContext) {
    return this.tenantPrisma.run(async (tx) => {
      const people = await tx.orgUser.findMany({
        where: { isActive: true, id: { not: con.orgUserId } },
        select: { id: true, user: { select: { fullName: true } }, conUserRoles: { select: { role: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        people: people.map((p) => ({ orgUserId: p.id, fullName: p.user.fullName, roles: p.conUserRoles.map((r) => r.role) })),
        projects: await this.visibleProjects(tx, con),
      };
    });
  }

  unread(con: ConContext) {
    return this.tenantPrisma.run(async (tx) => ({ unread: await tx.conMessageRecipient.count({ where: { orgUserId: con.orgUserId, readAt: null } }) }));
  }

  /** The inbox (messages to me) or sent box, newest first. */
  list(con: ConContext, box: 'inbox' | 'sent' = 'inbox') {
    return this.tenantPrisma.run(async (tx) => {
      const rows =
        box === 'sent'
          ? await tx.conMessage.findMany({ where: { senderOrgUserId: con.orgUserId }, include: { recipients: { select: { orgUserId: true, readAt: true } } }, orderBy: { createdAt: 'desc' }, take: LIST })
          : (await tx.conMessageRecipient.findMany({ where: { orgUserId: con.orgUserId }, include: { message: { include: { recipients: { select: { orgUserId: true, readAt: true } } } } }, orderBy: { createdAt: 'desc' }, take: LIST })).map((r) => ({ ...r.message, myReadAt: r.readAt }));
      const names = await this.names(tx, rows.flatMap((m) => [m.senderOrgUserId, ...m.recipients.map((r) => r.orgUserId)]));
      const projects = new Map((await tx.conProject.findMany({ where: { id: { in: rows.map((m) => m.projectId).filter((p): p is string => !!p) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
      return {
        unread: await tx.conMessageRecipient.count({ where: { orgUserId: con.orgUserId, readAt: null } }),
        messages: rows.map((m) => ({
          id: m.id,
          threadId: m.threadId ?? m.id,
          subject: m.subject,
          snippet: snippet(m.body),
          from: names.get(m.senderOrgUserId) ?? 'Someone',
          to: m.recipients.map((r) => names.get(r.orgUserId) ?? 'Someone'),
          project: m.projectId ? (projects.get(m.projectId) ?? null) : null,
          createdAt: m.createdAt,
          read: 'myReadAt' in m ? m.myReadAt !== null : true,
          readBy: m.recipients.filter((r) => r.readAt).length,
        })),
      };
    });
  }

  /** A whole conversation, oldest first; opening it marks my copies read. Only someone in the conversation may open it. */
  thread(con: ConContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const first = await tx.conMessage.findUnique({ where: { id } });
      if (!first) throw new NotFoundException('Message not found');
      const root = first.threadId ?? first.id;
      const messages = await tx.conMessage.findMany({ where: { OR: [{ id: root }, { threadId: root }] }, include: { recipients: { select: { orgUserId: true, readAt: true } } }, orderBy: { createdAt: 'asc' } });
      const inIt = messages.some((m) => m.senderOrgUserId === con.orgUserId || m.recipients.some((r) => r.orgUserId === con.orgUserId));
      if (!inIt) throw new NotFoundException('Message not found');
      await tx.conMessageRecipient.updateMany({ where: { orgUserId: con.orgUserId, readAt: null, messageId: { in: messages.map((m) => m.id) } }, data: { readAt: new Date() } });
      const names = await this.names(tx, messages.flatMap((m) => [m.senderOrgUserId, ...m.recipients.map((r) => r.orgUserId)]));
      const project = messages[0].projectId ? await tx.conProject.findUnique({ where: { id: messages[0].projectId }, select: { id: true, code: true, name: true } }) : null;
      return {
        threadId: root,
        subject: messages[0].subject,
        project,
        messages: messages.map((m) => ({
          id: m.id,
          from: names.get(m.senderOrgUserId) ?? 'Someone',
          mine: m.senderOrgUserId === con.orgUserId,
          to: m.recipients.map((r) => ({ name: names.get(r.orgUserId) ?? 'Someone', read: r.readAt !== null })),
          body: m.body,
          createdAt: m.createdAt,
        })),
      };
    });
  }

  /** Sends a message (or a reply to everyone in the conversation). At least one person besides the sender must receive it. */
  send(con: ConContext, dto: SendMessageDto) {
    return this.tenantPrisma.run(async (tx) => {
      const people = new Set<string>();
      let subject = dto.subject?.trim() ?? '';
      let projectId = dto.projectId ?? null;
      let threadId: string | null = null;
      if (dto.replyTo) {
        const first = await tx.conMessage.findUnique({ where: { id: dto.replyTo } });
        if (!first) throw new NotFoundException('Message not found');
        threadId = first.threadId ?? first.id;
        const thread = await tx.conMessage.findMany({ where: { OR: [{ id: threadId }, { threadId }] }, include: { recipients: { select: { orgUserId: true } } } });
        const inIt = thread.some((m) => m.senderOrgUserId === con.orgUserId || m.recipients.some((r) => r.orgUserId === con.orgUserId));
        if (!inIt) throw new NotFoundException('Message not found');
        for (const m of thread) [m.senderOrgUserId, ...m.recipients.map((r) => r.orgUserId)].forEach((p) => people.add(p));
        const root = thread.find((m) => m.id === threadId)!;
        subject = root.subject.startsWith('Re: ') ? root.subject : `Re: ${root.subject}`;
        projectId = root.projectId;
      } else {
        if (dto.everyone) (await tx.orgUser.findMany({ where: { isActive: true }, select: { id: true } })).forEach((u) => people.add(u.id));
        if (dto.projectId) {
          const visible = await this.visibleProjects(tx, con);
          if (!visible.some((p) => p.id === dto.projectId)) throw new NotFoundException('Project not found');
          (await tx.conProjectMember.findMany({ where: { projectId: dto.projectId }, select: { orgUserId: true } })).forEach((m) => people.add(m.orgUserId));
        }
        if (dto.to?.length) {
          const found = await tx.orgUser.findMany({ where: { id: { in: dto.to }, isActive: true }, select: { id: true } });
          if (found.length !== new Set(dto.to).size) throw new BadRequestException('One of those people is not in the company');
          found.forEach((u) => people.add(u.id));
        }
        if (!subject) throw new BadRequestException('Give the message a subject');
      }
      people.delete(con.orgUserId);
      if (people.size === 0) throw new BadRequestException(dto.projectId ? 'Nobody else is on that project yet' : 'Choose who to send it to');
      const message = await tx.conMessage.create({ data: { organizationId: con.organizationId, senderOrgUserId: con.orgUserId, subject, body: dto.body, projectId, threadId } });
      await tx.conMessageRecipient.createMany({ data: [...people].map((orgUserId) => ({ organizationId: con.organizationId, messageId: message.id, orgUserId })) });
      await this.audit.logInTx(tx, { action: 'con_message.sent', entityType: 'ConMessage', entityId: message.id, after: { subject, recipients: people.size, projectId, threadId } });
      return { id: message.id, threadId: threadId ?? message.id, recipients: people.size };
    });
  }
}
