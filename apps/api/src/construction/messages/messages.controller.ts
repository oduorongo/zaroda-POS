import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConRoleCode } from '@prisma/client';
import { ConRequest, ConRoles, ConWriteWhenSuspended, ConstructionGuard } from '../common/con-access';
import { MessageListQueryDto, SendMessageDto } from '../dto/messages.dto';
import { MessagesService } from './messages.service';

const INTERNAL: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_PROJECT_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_COMPLIANCE', 'CON_SHE_OFFICER', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_STOREKEEPER', 'CON_TIMEKEEPER'];

/** In-app messages between staff. Everyone in the company can message; a lapsed plan does not stop it (like alerts). */
@Controller('construction/messages')
@UseGuards(ConstructionGuard)
@ConRoles(...INTERNAL)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@Req() req: ConRequest, @Query() q: MessageListQueryDto) {
    return this.messages.list(req.con!, q.box);
  }

  @Get('unread')
  unread(@Req() req: ConRequest) {
    return this.messages.unread(req.con!);
  }

  @Get('recipients')
  recipients(@Req() req: ConRequest) {
    return this.messages.recipients(req.con!);
  }

  @Get(':id')
  thread(@Req() req: ConRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.messages.thread(req.con!, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ConWriteWhenSuspended()
  @Post()
  send(@Req() req: ConRequest, @Body() dto: SendMessageDto) {
    return this.messages.send(req.con!, dto);
  }
}
