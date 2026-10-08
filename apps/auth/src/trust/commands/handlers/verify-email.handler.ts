import { BadRequestException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MoreThan } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';

// import features
import { Email } from '../../../identity/models/email.entity.js';
import { User } from '../../../identity/models/user.entity.js';
import { EmailVerificationToken } from '../../models/email-verification-token.entity.js';
import { hashVerificationToken } from '../../services/email-verification.service.js';

// import commands
import { VerifyEmailCommand } from '../verify-email.command.js';

const INVALID_LINK = 'Verification link is invalid or has expired';

@CommandHandler(VerifyEmailCommand)
export class VerifyEmailHandler implements ICommandHandler<
  VerifyEmailCommand,
  void
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async execute(command: VerifyEmailCommand): Promise<void> {
    const tokenHash = hashVerificationToken(command.dto.token);

    await this.dataSource.transaction(async (manager) => {
      const tokens = manager.getRepository(EmailVerificationToken);
      const token = await tokens.findOne({
        where: { tokenHash, used: false, expiresAt: MoreThan(new Date()) },
      });
      if (!token) {
        throw new BadRequestException(INVALID_LINK);
      }

      // The conditional update is what makes the link single-use under concurrent requests
      const claimed = await tokens.update(
        { id: token.id, used: false },
        { used: true },
      );
      if (claimed.affected !== 1) {
        throw new BadRequestException(INVALID_LINK);
      }

      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { id: token.userId } });
      if (!user) {
        throw new BadRequestException(INVALID_LINK);
      }
      user.isEmailVerified = true;
      await users.save(user);

      const emails = manager.getRepository(Email);
      const primary = await emails.findOne({
        where: { userId: user.id, isPrimary: true },
      });
      if (primary) {
        primary.isVerified = true;
        await emails.save(primary);
      }

      await this.audit.record(
        {
          action: 'auth.email.verified',
          entityType: 'user',
          entityId: user.id,
          scope: `user:${user.id}`,
        },
        manager,
      );
    });
  }
}
