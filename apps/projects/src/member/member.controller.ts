import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Delete } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Patch } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';
import { extractAccessToken } from '@libs/common';

// import features
import type { AuthenticatedUser } from '../identity/index.js';
import type { ProjectSummary } from '../project/index.js';

// import commands
import { ChangeMemberRoleCommand } from './commands/change-member-role.command.js';
import { RemoveMemberCommand } from './commands/remove-member.command.js';
import { TransferOwnershipCommand } from './commands/transfer-ownership.command.js';

// import queries
import { ListMembersQuery } from './queries/list-members.query.js';

// import dtos
import { ChangeMemberRoleDto } from './dto/change-member-role.dto.js';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto.js';

// import interfaces
import type { MemberView } from './interfaces/member-view.js';

@ApiTags('Members')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class MemberController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('members')
  @ApiOperation({ summary: 'List the members of a project.' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: Parameters<typeof extractAccessToken>[0],
  ): Promise<MemberView[]> {
    // The web app signs in with a cookie, API tools with a header: either way auth is shown a bearer token
    const token = extractAccessToken(request);
    return this.queryBus.execute(
      new ListMembersQuery(
        user.id,
        projectId,
        token ? `Bearer ${token}` : undefined,
      ),
    );
  }

  @Patch('members/:userId')
  @ApiOperation({
    summary:
      'Promote or demote another member. Owners only; nobody can change their own role.',
  })
  changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: ChangeMemberRoleDto,
  ): Promise<MemberView> {
    return this.commandBus.execute(
      new ChangeMemberRoleCommand(user.id, projectId, targetUserId, dto.role),
    );
  }

  @Delete('members/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a member from a project. Owners only.' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.commandBus.execute(
      new RemoveMemberCommand(user.id, projectId, targetUserId),
    );
  }

  @Post('transfer-ownership')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Hand the project to another member, who becomes an owner. You become a member.',
  })
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: TransferOwnershipDto,
  ): Promise<ProjectSummary> {
    return this.commandBus.execute(
      new TransferOwnershipCommand(user.id, projectId, dto.userId),
    );
  }
}
