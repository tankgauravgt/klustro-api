import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
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

// import dtos
import { CreateInviteDto } from './dto/create-invite.dto.js';

// import interfaces
import type { InviteLink } from './interfaces/invite-link.js';

@ApiTags('invites')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class InviteController {
  constructor(private readonly commandBus: CommandBus) {}

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
      new CreateInviteCommand(user.id, projectId, dto.expiresInMinutes),
    );
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
