import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import features
import { Email } from '../../../identity/models/email.entity.js';
import { User } from '../../../identity/models/user.entity.js';
import { PasswordResetToken } from '../../models/password-reset-token.entity.js';
import { PasswordResetEmailService } from '../../services/password-reset-email.service.js';

// import commands
import { ForgotPasswordCommand } from '../forgot-password.command.js';

export interface ForgotPasswordResult {
  message: string;
}

const TOKEN_TTL_MINUTES = 30;

@CommandHandler(ForgotPasswordCommand)
export class ForgotPasswordHandler implements ICommandHandler<
  ForgotPasswordCommand,
  ForgotPasswordResult
> {
  constructor(
    @InjectRepository(Email)
    private readonly emailsRepository: Repository<Email>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokensRepository: Repository<PasswordResetToken>,
    private readonly resetEmail: PasswordResetEmailService,
  ) {}

  // The same answer whether or not the address has an account, so the response reveals nothing
  async execute(command: ForgotPasswordCommand): Promise<ForgotPasswordResult> {
    const message =
      'If that email is registered, a password reset link has been sent.';

    const email = await this.emailsRepository.findOne({
      where: { email: command.dto.email },
    });
    if (!email) {
      return { message };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

    await this.resetTokensRepository.save(
      this.resetTokensRepository.create({
        userId: email.userId,
        tokenHash,
        expiresAt,
        used: false,
      }),
    );

    const user = await this.usersRepository.findOneOrFail({
      where: { id: email.userId },
    });
    await this.resetEmail.sendResetEmail(
      {
        name: `${user.firstName ?? ''} ${user.lastName ?? ''}`,
        email: email.email,
      },
      rawToken,
    );

    return { message };
  }
}
