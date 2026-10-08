import { BadRequestException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import commands
import { DisconnectOAuthCommand } from '../disconnect-oauth.command.js';

// import models
import { OAuthAccount } from '../../models/oauth-account.entity.js';
import { User } from '../../models/user.entity.js';

@CommandHandler(DisconnectOAuthCommand)
export class DisconnectOAuthHandler implements ICommandHandler<
  DisconnectOAuthCommand,
  void
> {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(OAuthAccount)
    private readonly oauthAccounts: Repository<OAuthAccount>,
  ) {}

  async execute(command: DisconnectOAuthCommand): Promise<void> {
    const { userId, provider } = command;

    const link = await this.oauthAccounts.findOne({
      where: { userId, provider },
    });
    if (!link) {
      throw new NotFoundException(`No ${provider} account connected`);
    }

    const user = await this.usersRepository.findOneOrFail({
      where: { id: userId },
    });
    if (!user.passwordHash) {
      const otherLinks = await this.oauthAccounts.count({ where: { userId } });
      if (otherLinks <= 1) {
        throw new BadRequestException(
          'Set a password before disconnecting your only sign-in method',
        );
      }
    }

    await this.oauthAccounts.softRemove(link);
  }
}
