import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { AiService } from './ai.service';
import { AskDto } from './dto/ask.dto';

// The business's own figures, so owners and managers only.
@Roles(Role.MANAGER, Role.OWNER)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get()
  overview() {
    return this.ai.overview();
  }

  @Post('weekly')
  @HttpCode(200)
  weekly() {
    return this.ai.weekly();
  }

  @Post('ask')
  @HttpCode(200)
  ask(@Body() dto: AskDto) {
    return this.ai.ask(dto.question);
  }
}
