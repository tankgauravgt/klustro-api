import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

// import modules
import { ProjectModule } from '../project/project.module.js';

// import controllers
import { AuditController } from './audit.controller.js';

// import handlers
import { ListProjectActivityHandler } from './queries/handlers/list-project-activity.handler.js';
import { ListProjectAuditLogsHandler } from './queries/handlers/list-project-audit-logs.handler.js';
import { VerifyProjectAuditHandler } from './queries/handlers/verify-project-audit.handler.js';

@Module({
  imports: [CqrsModule, ProjectModule],
  controllers: [AuditController],
  providers: [
    ListProjectActivityHandler,
    ListProjectAuditLogsHandler,
    VerifyProjectAuditHandler,
  ],
})
export class AuditModule {}
