import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  getHealth(): { status: string } {
    return this.appService.getHealth();
  }

  @Public()
  @Get('ready')
  getReady() {
    return this.appService.getReady();
  }
}
