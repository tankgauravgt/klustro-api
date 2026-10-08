import { Controller } from '@nestjs/common';
import { Delete } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import commands
import { DisconnectOAuthCommand } from './commands/disconnect-oauth.command.js';

// import queries
import { GetConnectionsQuery } from './queries/get-connections.query.js';

// import models
import type { OAuthProvider } from './models/oauth-account.entity.js';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';

// import interfaces
import type { RequestUser } from '../access/interfaces/request-user.js';

/*
 * Provider-agnostic: listing/disconnecting connections is independent of
 * the original sign-in method module (google, github, etc.).
 */
@ApiTags('Identity')
@Controller('auth/connections')
export class ConnectionsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List connected providers for the current account.',
  })
  listConnections(@CurrentUser() user: RequestUser) {
    return this.queryBus.execute(new GetConnectionsQuery(user.id));
  }

  @Delete(':provider')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disconnect a provider from the current account.' })
  disconnect(
    @CurrentUser() user: RequestUser,
    @Param('provider') provider: OAuthProvider,
  ): Promise<void> {
    return this.commandBus.execute(
      new DisconnectOAuthCommand(user.id, provider),
    );
  }
}
