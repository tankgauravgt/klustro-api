import { IQueryHandler } from '@nestjs/cqrs';
import { QueryHandler } from '@nestjs/cqrs';

// import application libraries
import { AuditService } from '@libs/governance';
import type { AuditLogPage } from '@libs/governance';

// import queries
import { ListAccountAuditLogsQuery } from '../list-account-audit-logs.query.js';

@QueryHandler(ListAccountAuditLogsQuery)
export class ListAccountAuditLogsHandler implements IQueryHandler<
  ListAccountAuditLogsQuery,
  AuditLogPage
> {
  constructor(private readonly audit: AuditService) {}

  execute(query: ListAccountAuditLogsQuery): Promise<AuditLogPage> {
    return this.audit.list(`user:${query.userId}`, query.limit, query.before);
  }
}
