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
import { ListProjectAuditLogsQuery } from './queries/list-project-audit-logs.query.js';

@ApiTags('audit')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/audit-logs')
export class AuditController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
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
}
