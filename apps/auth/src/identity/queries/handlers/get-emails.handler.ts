import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import queries
import { GetEmailsQuery } from '../get-emails.query.js';

// import models
import { Email } from '../../models/email.entity.js';
import { OAuthAccount } from '../../models/oauth-account.entity.js';

export type EmailResult = Omit<Email, 'provider'> & {
  // The connected provider that supplies this address. It cannot be removed until that
  // connection is disconnected. Null for addresses the person added themselves.
  providedBy: string | null;
};

@QueryHandler(GetEmailsQuery)
export class GetEmailsHandler implements IQueryHandler<
  GetEmailsQuery,
  EmailResult[]
> {
  constructor(
    @InjectRepository(Email)
    private readonly emailsRepository: Repository<Email>,
    @InjectRepository(OAuthAccount)
    private readonly oauthAccounts: Repository<OAuthAccount>,
  ) {}

  async execute(query: GetEmailsQuery): Promise<EmailResult[]> {
    const emails = await this.emailsRepository.find({
      where: { userId: query.userId },
    });
    const connected = new Set(
      (await this.oauthAccounts.find({ where: { userId: query.userId } })).map(
        (link) => link.provider,
      ),
    );

    return emails.map(({ provider, ...email }) => ({
      ...email,
      providedBy:
        provider && connected.has(provider as never) ? provider : null,
    }));
  }
}
