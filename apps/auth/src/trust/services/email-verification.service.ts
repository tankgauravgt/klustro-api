import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { AppConfigService } from '@libs/common';
import type { MailRecipient } from '@libs/mail';
import { MailService } from '@libs/mail';

// import models
import { User } from '../../identity/models/user.entity.js';
import { EmailVerificationToken } from '../models/email-verification-token.entity.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const hashVerificationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly config: AppConfigService,
    private readonly mail: MailService,
    @InjectRepository(EmailVerificationToken)
    private readonly tokens: Repository<EmailVerificationToken>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /*
   * Written inside the sign-up transaction, so an account never exists without its token. With an
   * `emailId` the link confirms that address instead, and any link still open for it stops working.
   */
  async issue(
    manager: EntityManager,
    userId: string,
    emailId: string | null = null,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const tokens = manager.getRepository(EmailVerificationToken);
    if (emailId) {
      await tokens.update({ emailId, used: false }, { used: true });
    }
    await tokens.save(
      tokens.create({
        userId,
        emailId,
        tokenHash: hashVerificationToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        used: false,
      }),
    );
    return token;
  }

  // Mails a fresh link for an address added to an existing account
  async sendForAddress(
    userId: string,
    address: { id: string; email: string },
  ): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
    const token = await this.issue(this.tokens.manager, userId, address.id);
    await this.sendAddressVerificationEmail(
      { name, email: address.email },
      token,
    );
  }

  sendVerificationEmail(to: MailRecipient, token: string): Promise<void> {
    return this.mail.send({
      to,
      subject: 'Welcome to Klustro - Activate Your Account',
      text: [
        `Hi ${to.name.split(' ')[0] || 'there'},`,
        '',
        'Welcome to Klustro! We are glad to have you. Confirm your email address to activate your account:',
        '',
        this.linkFor(token),
        '',
        'The link works once and expires in 24 hours. If you did not create a Klustro account, you can ignore this email.',
        '',
        'See you inside,',
        'The Klustro team',
      ].join('\n'),
    });
  }

  sendAddressVerificationEmail(
    to: MailRecipient,
    token: string,
  ): Promise<void> {
    return this.mail.send({
      to,
      subject: 'Confirm your email address for Klustro',
      text: [
        `Hi ${to.name.split(' ')[0] || 'there'},`,
        '',
        'This address was added to a Klustro account. Confirm that it is yours:',
        '',
        this.linkFor(token),
        '',
        'The link works once and expires in 24 hours. If you did not add this address, you can ignore this email.',
        '',
        'The Klustro team',
      ].join('\n'),
    });
  }

  private linkFor(token: string): string {
    return `${this.config.get('WEB_URL')}/verify-email?token=${token}`;
  }
}
