import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

// import application libraries
import { AppConfigService } from '@libs/common';
import type { MailRecipient } from '@libs/mail';
import { MailService } from '@libs/mail';

// import models
import { EmailVerificationToken } from '../models/email-verification-token.entity.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const hashVerificationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly config: AppConfigService,
    private readonly mail: MailService,
  ) {}

  // Written inside the sign-up transaction, so an account never exists without its token
  async issue(manager: EntityManager, userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const tokens = manager.getRepository(EmailVerificationToken);
    await tokens.save(
      tokens.create({
        userId,
        tokenHash: hashVerificationToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        used: false,
      }),
    );
    return token;
  }

  sendVerificationEmail(to: MailRecipient, token: string): Promise<void> {
    const link = `${this.config.get('WEB_URL')}/verify-email?token=${token}`;
    return this.mail.send({
      to,
      subject: 'Welcome to Klustro - Activate Your Account',
      text: [
        `Hi ${to.name.split(' ')[0] || 'there'},`,
        '',
        'Welcome to Klustro! We are glad to have you. Confirm your email address to activate your account:',
        '',
        link,
        '',
        'The link works once and expires in 24 hours. If you did not create a Klustro account, you can ignore this email.',
        '',
        'See you inside,',
        'The Klustro team',
      ].join('\n'),
    });
  }
}
