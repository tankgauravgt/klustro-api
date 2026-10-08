import { Controller } from '@nestjs/common';
import { Get } from '@nestjs/common';
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
import type { RequestUser } from '../access/interfaces/request-user.js';

// import queries
import { ListAccountAuditLogsQuery } from './queries/list-account-audit-logs.query.js';

@ApiTags('Governance')
@Controller('auth/audit-logs')
export class AuditController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Read the audit trail of your own account, newest first.',
  })
  list(
    @CurrentUser() user: RequestUser,
    @Query() dto: ListAuditLogsDto,
  ): Promise<AuditLogPage> {
    return this.queryBus.execute(
      new ListAccountAuditLogsQuery(user.id, dto.limit, dto.before),
    );
  }
}
