import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

// import modules
import { ProjectModule } from '../project/project.module.js';

// import controllers
import { AuditController } from './audit.controller.js';

// import handlers
import { ListProjectAuditLogsHandler } from './queries/handlers/list-project-audit-logs.handler.js';

@Module({
  imports: [CqrsModule, ProjectModule],
  controllers: [AuditController],
  providers: [ListProjectAuditLogsHandler],
})
export class AuditModule {}
