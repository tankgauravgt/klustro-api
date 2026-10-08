import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { Patch } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';
import { RateLimitGuard } from '@libs/common';

// import commands
import { ChangeUsernameCommand } from './commands/change-username.command.js';

// import queries
import { GetProfileQuery } from './queries/get-profile.query.js';

// import handlers
import type { ProfileResult } from './queries/handlers/get-profile.handler.js';

// import dtos
import { ChangeUsernameDto } from './dto/change-username.dto.js';

// import guards, decorators and strategies

// import interfaces
import type { RequestUser } from '../access/interfaces/request-user.js';

// Provider-agnostic: identical regardless of which sign-in method was used
@ApiTags('Identity')
@Controller('auth')
export class ProfileController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the profile of the currently authenticated account.',
  })
  getCurrentUser(@CurrentUser() user: RequestUser): Promise<ProfileResult> {
    return this.queryBus.execute(new GetProfileQuery(user.id));
  }

  @Patch('username')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Change your username. It is also a sign-in name; the old one is free immediately.',
  })
  async changeUsername(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangeUsernameDto,
  ): Promise<ProfileResult> {
    await this.commandBus.execute(
      new ChangeUsernameCommand(user.id, dto.username),
    );
    return this.queryBus.execute(new GetProfileQuery(user.id));
  }
}
