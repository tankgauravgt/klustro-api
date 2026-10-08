import { ConflictException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';
import { RequestContextService } from '@libs/governance';

// import services
import { EmailClaimService } from '../../../trust/services/email-claim.service.js';
import { TokenService } from '../../services/token.service.js';

// import commands
import { OAuthSignInCommand } from '../oauth-sign-in.command.js';

// import models
import { Email } from '../../../identity/models/email.entity.js';
import { OAuthAccount } from '../../../identity/models/oauth-account.entity.js';
import { User } from '../../../identity/models/user.entity.js';

// import interfaces
import { AuthResult } from '../../interfaces/auth-result.js';

// import others
import { normalizeEmail } from '../../../identity/utils/normalize-email.js';
import { USERNAME_MAX_LENGTH } from '../../../identity/utils/username.js';
import { USERNAME_MIN_LENGTH } from '../../../identity/utils/username.js';
import { normalizeUsername } from '../../../identity/utils/username.js';

@CommandHandler(OAuthSignInCommand)
export class OAuthSignInHandler implements ICommandHandler<
  OAuthSignInCommand,
  AuthResult
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
    private readonly claims: EmailClaimService,
    private readonly context: RequestContextService,
  ) {}

  async execute(command: OAuthSignInCommand): Promise<AuthResult> {
    const { profile } = command;

    const user = await this.dataSource.transaction(async (manager) => {
      const oauthAccounts = manager.getRepository(OAuthAccount);

      const existingLink = await oauthAccounts.findOne({
        where: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
      if (existingLink) {
        const linked = await manager
          .getRepository(User)
          .findOneOrFail({ where: { id: existingLink.userId } });
        // Same rule as the password sign-in: a deactivated account gets no session
        if (!linked.isActive) {
          throw new UnauthorizedException('Account is not active');
        }
        return linked;
      }

      // The provider has proven this address, so it beats any claim that is not verified
      const address = normalizeEmail(profile.email);
      const claim = await this.claims.find(manager, address);

      let owner: User;
      if (claim.kind === 'held' && claim.email.isVerified) {
        owner = claim.owner;
        // Checked before anything is linked to it
        if (!owner.isActive) {
          throw new UnauthorizedException('Account is not active');
        }
      } else {
        if (claim.kind === 'held') {
          await this.claims.releaseUnverified(
            manager,
            claim,
            `oauth:${profile.provider}`,
          );
        }
        owner = await this.createUserFromProfile(manager, {
          ...profile,
          email: address,
        });
      }

      const alreadyLinkedProvider = await oauthAccounts.findOne({
        where: { userId: owner.id, provider: profile.provider },
      });
      if (alreadyLinkedProvider) {
        throw new ConflictException(
          `A different ${profile.provider} account is already connected`,
        );
      }

      await oauthAccounts.save(
        oauthAccounts.create({
          userId: owner.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        }),
      );

      return owner;
    });

    this.context.setActor(user.id);
    await this.audit.record({
      action: 'auth.signin',
      entityType: 'user',
      entityId: user.id,
      scope: `user:${user.id}`,
      metadata: { method: profile.provider },
    });

    return {
      accessToken: this.tokenService.issue(user),
      requiresPasswordSetup: user.requiresPasswordSetup,
    };
  }

  private async createUserFromProfile(
    manager: EntityManager,
    profile: OAuthSignInCommand['profile'],
  ): Promise<User> {
    const usersRepository = manager.getRepository(User);
    const emailsRepository = manager.getRepository(Email);

    const username = await this.generateUniqueUsername(manager, profile.email);

    const newUser = await usersRepository.save(
      usersRepository.create({
        username,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        passwordHash: null,
        requiresPasswordSetup: true,
        isEmailVerified: true,
      }),
    );

    await emailsRepository.save(
      emailsRepository.create({
        userId: newUser.id,
        email: profile.email,
        isPrimary: true,
        // OAuth provider attests to this address
        isVerified: true,
        provider: profile.provider,
      }),
    );

    return newUser;
  }

  private async generateUniqueUsername(
    manager: EntityManager,
    email: string,
  ): Promise<string> {
    const usersRepository = manager.getRepository(User);

    // Start from the part of the email before the @, kept to the characters usernames allow
    const local = normalizeUsername(email.split('@')[0]).replace(
      /[^a-z0-9._-]/g,
      '',
    );
    const base = local.length >= USERNAME_MIN_LENGTH ? local : `${local}user`;

    let candidate = base.slice(0, USERNAME_MAX_LENGTH);
    let suffix = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const taken = await usersRepository.findOne({
        where: { username: candidate, isActive: true },
      });
      if (!taken) {
        return candidate;
      }
      suffix += 1;
      const digits = String(suffix);
      candidate = `${base.slice(0, USERNAME_MAX_LENGTH - digits.length)}${digits}`;
    }
  }
}
