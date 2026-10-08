import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

// import controllers
import { AuditController } from './audit.controller.js';

// import handlers
import { ListAccountAuditLogsHandler } from './queries/handlers/list-account-audit-logs.handler.js';

// The account's audit trail (the recording itself is done by `@libs/governance`)
@Module({
  imports: [CqrsModule],
  controllers: [AuditController],
  providers: [ListAccountAuditLogsHandler],
})
export class AuthGovernanceModule {}
