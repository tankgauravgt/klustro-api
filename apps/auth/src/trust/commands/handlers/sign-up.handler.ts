import { ConflictException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';

// import application libraries
import { isUniqueViolation } from '@libs/common';
import { AuditService } from '@libs/governance';
import { RequestContextService } from '@libs/governance';

// import features
import { Email } from '../../../identity/models/email.entity.js';
import { EmailClaimService } from '../../services/email-claim.service.js';
import { EmailVerificationService } from '../../services/email-verification.service.js';
import { PasswordService } from '../../services/password.service.js';
import { IssueAccessTokenCommand } from '../../../access/commands/issue-access-token.command.js';
import { User } from '../../../identity/models/user.entity.js';
import { normalizeEmail } from '../../../identity/utils/normalize-email.js';
import { normalizeUsername } from '../../../identity/utils/username.js';
import type { EmailClaim } from '../../services/email-claim.service.js';

// import commands
import { SignUpCommand } from '../sign-up.command.js';

// import interfaces
import type { SignUpResult } from '../../interfaces/sign-up-result.js';

/*
 * Signing up with an email that something already holds:
 *   - held and verified: the address is proven, so the person must prove the account by its
 *     password and is then signed in to it (no second account);
 *   - held but unverified: the claim loses. An unverified primary email means a pending account
 *     (never usable, so never any data), which is replaced; an unverified secondary is removed.
 */
@CommandHandler(SignUpCommand)
export class SignUpHandler implements ICommandHandler<
  SignUpCommand,
  SignUpResult
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly passwordService: PasswordService,
    private readonly commandBus: CommandBus,
    private readonly claims: EmailClaimService,
    private readonly audit: AuditService,
    private readonly context: RequestContextService,
    private readonly verification: EmailVerificationService,
  ) {}

  async execute(command: SignUpCommand): Promise<SignUpResult> {
    const { dto } = command;
    const address = normalizeEmail(dto.email);
    let ownerId = null as string | null;
    let verificationToken = null as string | null;

    try {
      const result = await this.dataSource.transaction<SignUpResult>(
        async (manager) => {
          const claim = await this.claims.find(manager, address);

          if (claim.kind === 'held' && claim.email.isVerified) {
            ownerId = claim.owner.id;
            return this.signInToExistingAccount(
              claim,
              dto.existingAccountPassword,
              dto.password,
            );
          }
          if (claim.kind === 'held') {
            await this.claims.releaseUnverified(manager, claim, 'signup');
          }
          verificationToken = await this.createPendingAccount(
            manager,
            dto,
            address,
          );
          return { status: 'verification_required' };
        },
      );

      // Sent only once the account is committed, so the link never points at a rolled-back sign-up
      if (verificationToken) {
        await this.verification.sendVerificationEmail(
          { name: `${dto.firstName} ${dto.lastName}`, email: address },
          verificationToken,
        );
      }

      // This answer is the one that tells a stranger the address has an account, so the owner is
      // told that someone asked
      if (ownerId && result.status === 'password_required') {
        await this.recordProbe(ownerId, 'password_required');
      }
      return result;
    } catch (error) {
      // Recorded after the rollback so the refusal is kept, and shown to the account's owner
      if (ownerId && error instanceof ConflictException) {
        await this.recordProbe(ownerId, 'social_only_account');
      }
      if (ownerId && error instanceof UnauthorizedException) {
        await this.audit.record({
          action: 'auth.signup.existing_account',
          outcome: 'failure',
          entityType: 'user',
          entityId: ownerId,
          scope: `user:${ownerId}`,
          metadata: { reason: 'wrong_password' },
        });
      }
      // Another sign-up took the username or email between the checks and the insert
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          /username/i.test(error.message)
            ? 'Username already taken'
            : 'Email already in use',
        );
      }
      throw error;
    }
  }

  // What the owner sees in their own trail; the asker is never told it was recorded
  private recordProbe(ownerId: string, reason: string): Promise<void> {
    return this.audit.record({
      action: 'auth.signup.existing_account',
      outcome: 'denied',
      entityType: 'user',
      entityId: ownerId,
      scope: `user:${ownerId}`,
      metadata: { reason },
    });
  }

  private async signInToExistingAccount(
    claim: Extract<EmailClaim, { kind: 'held' }>,
    password: string | undefined,
    newPassword: string,
  ): Promise<SignUpResult> {
    const { owner } = claim;

    // Creating an account hashes the new password (slow). These two answers would otherwise come
    // back measurably sooner, which tells a stranger the address has an account.
    // Accounts made through Google or GitHub have no password to ask for
    if (!owner.passwordHash) {
      await this.passwordService.verifyDecoy(newPassword);
      throw new ConflictException(
        'This email belongs to an account that signs in with Google or GitHub. Please sign in that way.',
      );
    }
    if (password === undefined) {
      await this.passwordService.verifyDecoy(newPassword);
      return { status: 'password_required' };
    }
    if (!(await this.passwordService.verify(password, owner.passwordHash))) {
      throw new UnauthorizedException(
        'Incorrect password for the account that owns this email.',
      );
    }
    if (!owner.isEmailVerified) {
      throw new ForbiddenException('Verify your email before signing in.');
    }
    // Only said once the password has proven who is asking. Not a 401: that is the audit trail's
    // "wrong password" case, which this is not.
    if (!owner.isActive) {
      throw new ForbiddenException('This account is not active.');
    }

    this.context.setActor(owner.id);
    await this.audit.record({
      action: 'auth.signin',
      entityType: 'user',
      entityId: owner.id,
      scope: `user:${owner.id}`,
      metadata: { method: 'password', via: 'signup' },
    });
    return {
      status: 'signed_in',
      accessToken: await this.commandBus.execute(
        new IssueAccessTokenCommand(owner),
      ),
      requiresPasswordSetup: owner.requiresPasswordSetup,
    };
  }

  private async createPendingAccount(
    manager: EntityManager,
    dto: SignUpCommand['dto'],
    address: string,
  ): Promise<string> {
    const usersRepository = manager.getRepository(User);

    const username = normalizeUsername(dto.username);
    const existingUsername = await usersRepository.findOne({
      where: { username, isActive: true },
    });
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    const user = await usersRepository.save(
      usersRepository.create({
        username,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: address,
        passwordHash: await this.passwordService.hash(dto.password),
        requiresPasswordSetup: false,
        isEmailVerified: false,
      }),
    );
    const emailsRepository = manager.getRepository(Email);
    await emailsRepository.save(
      emailsRepository.create({
        userId: user.id,
        email: address,
        isPrimary: true,
        isVerified: false,
      }),
    );

    return this.verification.issue(manager, user.id);
  }
}
