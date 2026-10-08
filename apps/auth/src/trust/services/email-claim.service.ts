import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';

// import models
import { Email } from '../../identity/models/email.entity.js';
import { OAuthAccount } from '../../identity/models/oauth-account.entity.js';
import { User } from '../../identity/models/user.entity.js';

export type EmailClaim =
  { kind: 'free' } | { kind: 'held'; email: Email; owner: User };

/*
 * Who may hold an email address. A verified address is proof of ownership; an unverified one is
 * only a claim. When someone proves an address, unverified claims on it lose:
 *   - an unverified primary email belongs to a pending account that cannot have been used, so the
 *     whole account is discarded;
 *   - an unverified secondary email is simply removed from its account.
 */
@Injectable()
export class EmailClaimService {
  constructor(private readonly audit: AuditService) {}

  async find(manager: EntityManager, address: string): Promise<EmailClaim> {
    const email = await manager
      .getRepository(Email)
      .findOne({ where: { email: address } });
    if (!email) {
      return { kind: 'free' };
    }
    const owner = await manager
      .getRepository(User)
      .findOneOrFail({ where: { id: email.userId } });
    return { kind: 'held', email, owner };
  }

  async releaseUnverified(
    manager: EntityManager,
    claim: Extract<EmailClaim, { kind: 'held' }>,
    by: string,
  ): Promise<void> {
    const { email, owner } = claim;

    // A primary email on an account that is itself verified never happens, but if it did the
    // account must survive: only the claim is removed.
    if (email.isPrimary && !owner.isEmailVerified) {
      await this.discardPendingAccount(manager, owner);
      await this.audit.record(
        {
          action: 'auth.account.replaced',
          entityType: 'user',
          entityId: owner.id,
          scope: `user:${owner.id}`,
          metadata: { reason: 'unverified_primary_email_claimed', by },
        },
        manager,
      );
      return;
    }

    await manager.getRepository(Email).softRemove(email);
    await this.audit.record(
      {
        action: 'auth.email.claim_stripped',
        entityType: 'email',
        entityId: email.id,
        scope: `user:${owner.id}`,
        metadata: { reason: 'unverified_email_claimed', by },
      },
      manager,
    );
  }

  private async discardPendingAccount(
    manager: EntityManager,
    owner: User,
  ): Promise<void> {
    const emails = manager.getRepository(Email);
    const links = manager.getRepository(OAuthAccount);

    await emails.softRemove(await emails.find({ where: { userId: owner.id } }));
    await links.softRemove(await links.find({ where: { userId: owner.id } }));
    await manager.getRepository(User).softRemove(owner);
  }
}
