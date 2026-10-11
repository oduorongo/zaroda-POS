import { Global, Module } from '@nestjs/common';
import { AfricasTalkingSmsProvider } from './africas-talking-sms.provider';
import { ResendEmailProvider } from './resend-email.provider';

@Global()
@Module({
  providers: [AfricasTalkingSmsProvider, ResendEmailProvider],
  exports: [AfricasTalkingSmsProvider, ResendEmailProvider],
})
export class NotificationsModule {}
