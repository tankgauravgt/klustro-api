import { Controller } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Query } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';
import { ListAuditLogsDto } from '@libs/governance';
import type { AuditLogPage } from '@libs/governance';

// import features
import type { AuthenticatedUser } from '../identity/index.js';

// import queries
import { ListProjectActivityQuery } from './queries/list-project-activity.query.js';
import { ListProjectAuditLogsQuery } from './queries/list-project-audit-logs.query.js';
import { VerifyProjectAuditQuery } from './queries/verify-project-audit.query.js';

// import interfaces
import type { ActivityPage } from './interfaces/activity.js';
import type { AuditVerification } from './interfaces/activity.js';

@ApiTags('Audit')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class AuditController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Read the audit trail of a project, newest first. Owners only.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() dto: ListAuditLogsDto,
  ): Promise<AuditLogPage> {
    return this.queryBus.execute(
      new ListProjectAuditLogsQuery(user.id, projectId, dto.limit, dto.before),
    );
  }

  @Get('audit-logs/verify')
  @ApiOperation({
    summary:
      'Check that the hash chain of the audit trail is intact. Owners only.',
  })
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<AuditVerification> {
    return this.queryBus.execute(
      new VerifyProjectAuditQuery(user.id, projectId),
    );
  }

  @Get('activity')
  @ApiOperation({
    summary:
      'A short feed of what happened in the project, newest first. Any member.',
  })
  activity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() dto: ListAuditLogsDto,
  ): Promise<ActivityPage> {
    return this.queryBus.execute(
      new ListProjectActivityQuery(user.id, projectId, dto.limit, dto.before),
    );
  }
}
