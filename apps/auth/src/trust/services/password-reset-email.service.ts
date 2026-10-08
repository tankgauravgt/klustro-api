import { Injectable } from '@nestjs/common';

// import application libraries
import { AppConfigService } from '@libs/common';
import type { MailRecipient } from '@libs/mail';
import { MailService } from '@libs/mail';

@Injectable()
export class PasswordResetEmailService {
  constructor(
    private readonly config: AppConfigService,
    private readonly mail: MailService,
  ) {}

  sendResetEmail(to: MailRecipient, token: string): Promise<void> {
    const link = `${this.config.get('WEB_URL')}/reset-password?token=${token}`;
    return this.mail.send({
      to,
      subject: 'Reset your Klustro password',
      text: [
        `Hi ${to.name.split(' ')[0] || 'there'},`,
        '',
        'We received a request to reset the password for your Klustro account. Choose a new password here:',
        '',
        link,
        '',
        'The link works once and expires in 30 minutes. If you did not ask for this, ignore this email and your password stays the same.',
        '',
        'The Klustro team',
      ].join('\n'),
    });
  }
}
