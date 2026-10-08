import { ConflictException } from '@nestjs/common';
import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';

// import services
import { EmailClaimService } from '../../../trust/services/email-claim.service.js';

// import commands
import { ConnectOAuthCommand } from '../connect-oauth.command.js';

// import models
import { Email } from '../../models/email.entity.js';
import { OAuthAccount } from '../../models/oauth-account.entity.js';

// import others
import { normalizeEmail } from '../../utils/normalize-email.js';

/*
 * Links a Google or GitHub account to the signed-in account. The provider has proven its email
 * address, so that address joins the account as a verified email, under the same rules as
 * everywhere else: an address a different account has verified cannot be taken, while an
 * unverified claim on it loses.
 */
@CommandHandler(ConnectOAuthCommand)
export class ConnectOAuthHandler implements ICommandHandler<
  ConnectOAuthCommand,
  OAuthAccount
> {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly claims: EmailClaimService,
  ) {}

  async execute(command: ConnectOAuthCommand): Promise<OAuthAccount> {
    const { userId, profile } = command;

    return this.dataSource.transaction(async (manager) => {
      const oauthAccounts = manager.getRepository(OAuthAccount);

      const linkedElsewhere = await oauthAccounts.findOne({
        where: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
      if (linkedElsewhere) {
        throw new ConflictException(
          linkedElsewhere.userId === userId
            ? 'This account is already connected'
            : `This ${profile.provider} account is already connected to a different user`,
        );
      }

      const existingProviderLink = await oauthAccounts.findOne({
        where: { userId, provider: profile.provider },
      });
      if (existingProviderLink) {
        throw new ConflictException(
          `Disconnect the existing ${profile.provider} account first`,
        );
      }

      await this.addVerifiedEmail(
        manager,
        userId,
        normalizeEmail(profile.email),
        profile.provider,
      );

      return oauthAccounts.save(
        oauthAccounts.create({
          userId,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        }),
      );
    });
  }

  private async addVerifiedEmail(
    manager: EntityManager,
    userId: string,
    address: string,
    provider: string,
  ): Promise<void> {
    const emails = manager.getRepository(Email);
    const claim = await this.claims.find(manager, address);

    if (claim.kind === 'held') {
      if (claim.email.userId === userId) {
        // Already on this account: the provider's proof makes it verified
        if (!claim.email.isVerified) {
          claim.email.isVerified = true;
          await emails.save(claim.email);
        }
        return;
      }
      if (claim.email.isVerified) {
        throw new ConflictException(
          'This email address belongs to a different account',
        );
      }
      await this.claims.releaseUnverified(
        manager,
        claim,
        `connect:${provider}`,
      );
    }

    await emails.save(
      emails.create({
        userId,
        email: address,
        isPrimary: false,
        isVerified: true,
        provider,
      }),
    );
  }
}
