import { Module } from '@nestjs/common';

// import services
import { MailService } from './mail.service.js';

// Sends mail through Mailgun; the sending credentials come from AppConfigService
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
