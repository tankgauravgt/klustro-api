import { BadRequestException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';

// import features
import { AuthResult } from '../../../access/interfaces/auth-result.js';
import { PasswordService } from '../../../trust/services/password.service.js';
import { User } from '../../models/user.entity.js';

// import commands
import { IssueAccessTokenCommand } from '../../../access/commands/issue-access-token.command.js';
import { SetPasswordCommand } from '../set-password.command.js';

/*
 * An account with no password yet (made through Google or GitHub) sets its first one with just
 * the session it signed in with: there is nothing to prove. An account that already has a
 * password must prove it with the current one first, so a borrowed session cannot take over.
 */
@CommandHandler(SetPasswordCommand)
export class SetPasswordHandler implements ICommandHandler<
  SetPasswordCommand,
  AuthResult
> {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly passwordService: PasswordService,
    private readonly commandBus: CommandBus,
    private readonly audit: AuditService,
  ) {}

  async execute(command: SetPasswordCommand): Promise<AuthResult> {
    const user = await this.usersRepository.findOne({
      where: { id: command.userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }

    if (user.passwordHash) {
      await this.requireCurrentPassword(
        user,
        user.passwordHash,
        command.currentPassword,
      );
      if (
        await this.passwordService.verify(command.password, user.passwordHash)
      ) {
        throw new BadRequestException(
          'Choose a password different from the current one',
        );
      }
    }

    user.passwordHash = await this.passwordService.hash(command.password);
    user.requiresPasswordSetup = false;
    // Bumping tokenVersion invalidates the current token and issues a new one
    user.tokenVersion += 1;
    await this.usersRepository.save(user);

    return {
      accessToken: await this.commandBus.execute(
        new IssueAccessTokenCommand(user),
      ),
      requiresPasswordSetup: false,
    };
  }

  // A 400, not a 401: the session itself is fine, and a 401 would sign the person out of the app
  private async requireCurrentPassword(
    user: User,
    hash: string,
    currentPassword: string | undefined,
  ): Promise<void> {
    if (
      currentPassword &&
      (await this.passwordService.verify(currentPassword, hash))
    ) {
      return;
    }

    // Recorded in the owner's trail, whatever the reason the proof failed
    await this.audit.record({
      action: 'auth.password.change',
      outcome: 'failure',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      scope: `user:${user.id}`,
      metadata: {
        reason: currentPassword
          ? 'wrong_current_password'
          : 'current_password_missing',
      },
    });
    throw new BadRequestException(
      currentPassword
        ? 'Current password is incorrect'
        : 'Enter your current password to change it',
    );
  }
}
