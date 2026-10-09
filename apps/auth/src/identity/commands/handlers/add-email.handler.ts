import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { isUniqueViolation } from '@libs/common';
import { AuditService } from '@libs/governance';

// import services
import { EmailVerificationService } from '../../../trust/services/email-verification.service.js';

// import commands
import { AddEmailCommand } from '../add-email.command.js';

// import models
import { Email } from '../../models/email.entity.js';

// import interfaces
import type { AddedEmail } from '../../interfaces/added-email.js';

// Keeps one account from piling up addresses (each is a claim on that address)
export const MAX_EMAILS_PER_ACCOUNT = 10;

/*
 * Adds an unverified address to the account. An address that another account already holds is
 * answered exactly like a free one, so this endpoint cannot be used to find out who is registered:
 * nothing is added (and nothing is mailed), and the holder's own audit trail records that someone
 * tried. A free address is mailed a link that verifies it; if the mail fails, the address stays
 * and the person can ask for the link again.
 */
@CommandHandler(AddEmailCommand)
export class AddEmailHandler implements ICommandHandler<
  AddEmailCommand,
  AddedEmail
> {
  private readonly logger = new Logger(AddEmailHandler.name);

  constructor(
    @InjectRepository(Email)
    private readonly emailsRepository: Repository<Email>,
    private readonly audit: AuditService,
    private readonly verification: EmailVerificationService,
  ) {}

  async execute(command: AddEmailCommand): Promise<AddedEmail> {
    const { userId, email } = command;

    const count = await this.emailsRepository.countBy({ userId });
    if (count >= MAX_EMAILS_PER_ACCOUNT) {
      throw new BadRequestException(
        `An account can have at most ${MAX_EMAILS_PER_ACCOUNT} email addresses`,
      );
    }

    const existing = await this.emailsRepository.findOne({ where: { email } });
    if (existing) {
      return this.refuse(userId, existing);
    }

    try {
      const saved = await this.emailsRepository.save(
        this.emailsRepository.create({
          userId,
          email,
          isPrimary: false,
          isVerified: false,
        }),
      );
      await this.sendVerification(userId, saved.id, email);
      return this.describe(saved.id, email);
    } catch (error) {
      // Someone took the address between the check above and the insert
      if (isUniqueViolation(error)) {
        const winner = await this.emailsRepository.findOne({
          where: { email },
        });
        if (winner) {
          return this.refuse(userId, winner);
        }
      }
      throw error;
    }
  }

  private async sendVerification(
    userId: string,
    id: string,
    email: string,
  ): Promise<void> {
    try {
      await this.verification.sendForAddress(userId, { id, email });
    } catch (error) {
      this.logger.warn(
        `Could not send the verification email for ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async refuse(userId: string, held: Email): Promise<AddedEmail> {
    // The person's own account is theirs to learn about
    if (held.userId === userId) {
      throw new ConflictException('Email already in use');
    }

    await this.audit.record({
      action: 'auth.email.add_blocked',
      outcome: 'denied',
      entityType: 'email',
      entityId: held.id,
      scope: `user:${held.userId}`,
      metadata: { reason: 'held_by_another_account' },
    });
    return this.describe(randomUUID(), held.email);
  }

  private describe(id: string, email: string): AddedEmail {
    return { id, email, isPrimary: false, isVerified: false, providedBy: null };
  }
}
