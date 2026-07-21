import { Global, Module } from '@nestjs/common';
import { AfricasTalkingSmsProvider } from './africas-talking-sms.provider';

@Global()
@Module({
  providers: [AfricasTalkingSmsProvider],
  exports: [AfricasTalkingSmsProvider],
})
export class NotificationsModule {}
