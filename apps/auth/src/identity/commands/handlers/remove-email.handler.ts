import { BadRequestException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import commands
import { RemoveEmailCommand } from '../remove-email.command.js';

// import models
import { Email } from '../../models/email.entity.js';
import { OAuthAccount } from '../../models/oauth-account.entity.js';

@CommandHandler(RemoveEmailCommand)
export class RemoveEmailHandler implements ICommandHandler<
  RemoveEmailCommand,
  void
> {
  constructor(
    @InjectRepository(Email)
    private readonly emailsRepository: Repository<Email>,
    @InjectRepository(OAuthAccount)
    private readonly oauthAccounts: Repository<OAuthAccount>,
  ) {}

  async execute(command: RemoveEmailCommand): Promise<void> {
    const { userId, emailId } = command;

    const target = await this.emailsRepository.findOne({
      where: { id: emailId, userId },
    });
    if (!target) {
      throw new NotFoundException('Email not found for this account');
    }
    if (target.isPrimary) {
      throw new BadRequestException(
        'Set a different primary email before removing this one',
      );
    }
    // An address a connected provider supplies goes away with the connection, not before
    if (
      target.provider &&
      (await this.oauthAccounts.exists({
        where: { userId, provider: target.provider as never },
      }))
    ) {
      throw new BadRequestException(
        `This email comes from your ${target.provider} connection. Disconnect ${target.provider} first, then try again.`,
      );
    }

    await this.emailsRepository.softRemove(target);
  }
}
