import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan } from 'typeorm';
import { Repository } from 'typeorm';

// import features
import { PasswordResetToken } from '../../models/password-reset-token.entity.js';
import { PasswordService } from '../../services/password.service.js';
import { User } from '../../../identity/models/user.entity.js';

// import commands
import { ResetPasswordCommand } from '../reset-password.command.js';

@CommandHandler(ResetPasswordCommand)
export class ResetPasswordHandler implements ICommandHandler<
  ResetPasswordCommand,
  void
> {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokensRepository: Repository<PasswordResetToken>,
    private readonly passwordService: PasswordService,
  ) {}

  async execute(command: ResetPasswordCommand): Promise<void> {
    const tokenHash = createHash('sha256')
      .update(command.dto.token)
      .digest('hex');

    const resetToken = await this.resetTokensRepository.findOne({
      where: { tokenHash, used: false, expiresAt: MoreThan(new Date()) },
    });
    if (!resetToken) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const user = await this.usersRepository.findOne({
      where: { id: resetToken.userId },
    });
    if (!user) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    user.passwordHash = await this.passwordService.hash(
      command.dto.newPassword,
    );
    user.requiresPasswordSetup = false;
    // Invalidate all previously-issued tokens for this user
    user.tokenVersion += 1;
    await this.usersRepository.save(user);

    resetToken.used = true;
    await this.resetTokensRepository.save(resetToken);
  }
}
