import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Delete } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';

// import features
import type { AuthenticatedUser } from '../identity/index.js';
import type { ProjectSummary } from '../project/index.js';

// import commands
import { AcceptInviteCommand } from './commands/accept-invite.command.js';
import { CreateInviteCommand } from './commands/create-invite.command.js';
import { RevokeInviteCommand } from './commands/revoke-invite.command.js';

// import queries
import { ListInvitesQuery } from './queries/list-invites.query.js';
import { PreviewInviteQuery } from './queries/preview-invite.query.js';

// import dtos
import { CreateInviteDto } from './dto/create-invite.dto.js';

// import interfaces
import type { InviteLink } from './interfaces/invite-link.js';
import type { InvitePreview } from './interfaces/invite-summary.js';
import type { InviteSummary } from './interfaces/invite-summary.js';

// import pipes
import { InviteTokenPipe } from './pipes/invite-token.pipe.js';

@ApiTags('Invites')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class InviteController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('projects/:projectId/invites')
  @ApiOperation({
    summary: 'Create an expiring, single-use invite link. Owners only.',
  })
  createInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteLink> {
    return this.commandBus.execute(
      new CreateInviteCommand(
        user.id,
        projectId,
        dto.expiresInMinutes,
        dto.role,
      ),
    );
  }

  @Get('projects/:projectId/invites')
  @ApiOperation({
    summary: 'List the invites that can still be accepted. Owners only.',
  })
  listInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<InviteSummary[]> {
    return this.queryBus.execute(new ListInvitesQuery(user.id, projectId));
  }

  @Delete('projects/:projectId/invites/:inviteId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an invite link. Owners only.' })
  revokeInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ): Promise<void> {
    return this.commandBus.execute(
      new RevokeInviteCommand(user.id, projectId, inviteId),
    );
  }

  @Get('invites/:token')
  @ApiOperation({
    summary: 'See which project an invite link leads to, without joining it.',
  })
  previewInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token', InviteTokenPipe) token: string,
  ): Promise<InvitePreview> {
    return this.queryBus.execute(new PreviewInviteQuery(user.id, token));
  }

  @Post('invites/:token/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join a project through an invite link.' })
  acceptInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ): Promise<ProjectSummary> {
    return this.commandBus.execute(new AcceptInviteCommand(user.id, token));
  }
}
