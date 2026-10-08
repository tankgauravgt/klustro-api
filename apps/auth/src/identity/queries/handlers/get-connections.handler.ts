import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// import queries
import { GetConnectionsQuery } from '../get-connections.query.js';

// import models
import { OAuthAccount } from '../../models/oauth-account.entity.js';
import type { OAuthProvider } from '../../models/oauth-account.entity.js';

// Only what the account's owner needs; never the provider's own account id or the audit columns
export interface ConnectionResult {
  id: string;
  provider: OAuthProvider;
  connectedAt: Date;
}

@QueryHandler(GetConnectionsQuery)
export class GetConnectionsHandler implements IQueryHandler<
  GetConnectionsQuery,
  ConnectionResult[]
> {
  constructor(
    @InjectRepository(OAuthAccount)
    private readonly oauthAccounts: Repository<OAuthAccount>,
  ) {}

  async execute(query: GetConnectionsQuery): Promise<ConnectionResult[]> {
    const links = await this.oauthAccounts.find({
      where: { userId: query.userId },
      order: { createdAt: 'ASC' },
    });
    return links.map((link) => ({
      id: link.id,
      provider: link.provider,
      connectedAt: link.createdAt,
    }));
  }
}
