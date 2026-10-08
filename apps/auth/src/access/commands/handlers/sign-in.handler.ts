import { ForbiddenException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';
import { RequestContextService } from '@libs/governance';

// import features
import { AuthResult } from '../../interfaces/auth-result.js';
import { Email } from '../../../identity/models/email.entity.js';
import { PasswordService } from '../../../trust/services/password.service.js';
import { TokenService } from '../../services/token.service.js';
import { User } from '../../../identity/models/user.entity.js';
import { normalizeEmail } from '../../../identity/utils/normalize-email.js';
import { normalizeUsername } from '../../../identity/utils/username.js';

// import commands
import { SignInCommand } from '../sign-in.command.js';

@CommandHandler(SignInCommand)
export class SignInHandler implements ICommandHandler<
  SignInCommand,
  AuthResult
> {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Email)
    private readonly emailsRepository: Repository<Email>,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
    private readonly context: RequestContextService,
  ) {}

  async execute(command: SignInCommand): Promise<AuthResult> {
    const { identifier, password } = command.dto;

    const user = await this.resolveUser(identifier);
    if (!user || !user.isActive || !user.passwordHash) {
      await this.passwordService.verifyDecoy(password);
      await this.recordFailure(user, identifier, 'unusable_account');
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await this.passwordService.verify(
      password,
      user.passwordHash,
    );
    if (!isValid) {
      await this.recordFailure(user, identifier, 'wrong_password');
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      await this.recordFailure(user, identifier, 'email_not_verified');
      throw new ForbiddenException('Verify your email before signing in.');
    }

    this.context.setActor(user.id);
    await this.audit.record({
      action: 'auth.signin',
      entityType: 'user',
      entityId: user.id,
      scope: `user:${user.id}`,
      metadata: { method: 'password' },
    });

    return {
      accessToken: this.tokenService.issue(user),
      requiresPasswordSetup: user.requiresPasswordSetup,
    };
  }

  // The client only ever sees "Invalid credentials"; the real reason stays in the trail
  private recordFailure(
    user: User | null,
    identifier: string,
    reason: string,
  ): Promise<void> {
    return this.audit.record({
      action: 'auth.signin',
      outcome: 'failure',
      actorId: user?.id ?? null,
      entityType: 'user',
      entityId: user?.id ?? null,
      scope: user ? `user:${user.id}` : null,
      metadata: { method: 'password', identifier, reason },
    });
  }

  private async resolveUser(identifier: string): Promise<User | null> {
    const byUsername = await this.usersRepository.findOne({
      where: { username: normalizeUsername(identifier) },
    });
    if (byUsername) {
      return byUsername;
    }

    const email = await this.emailsRepository.findOne({
      where: { email: normalizeEmail(identifier) },
    });
    if (!email) {
      return null;
    }
    return this.usersRepository.findOne({ where: { id: email.userId } });
  }
}
