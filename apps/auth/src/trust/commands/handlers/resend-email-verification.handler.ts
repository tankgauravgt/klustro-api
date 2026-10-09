import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import services
import { EmailVerificationService } from '../../services/email-verification.service.js';

// import commands
import { ResendEmailVerificationCommand } from '../resend-email-verification.command.js';

// import models
import { Email } from '../../../identity/models/email.entity.js';

/*
 * Mails a fresh link for an unverified address on the caller's account; the link sent before stops
 * working. Anything else (an address already verified, one that is not theirs, or the stand-in id
 * given for an address another account holds) is answered the same way, so this cannot tell
 * whether an address added earlier is really on the account.
 */
@CommandHandler(ResendEmailVerificationCommand)
export class ResendEmailVerificationHandler implements ICommandHandler<
  ResendEmailVerificationCommand,
  void
> {
  constructor(
    @InjectRepository(Email)
    private readonly emailsRepository: Repository<Email>,
    private readonly verification: EmailVerificationService,
  ) {}

  async execute(command: ResendEmailVerificationCommand): Promise<void> {
    const { userId, emailId } = command;

    const address = await this.emailsRepository.findOne({
      where: { id: emailId, userId },
    });
    if (!address || address.isVerified) {
      return;
    }

    await this.verification.sendForAddress(userId, address);
  }
}
