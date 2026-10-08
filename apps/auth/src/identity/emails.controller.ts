import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Delete } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Patch } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import commands
import { AddEmailCommand } from './commands/add-email.command.js';
import { RemoveEmailCommand } from './commands/remove-email.command.js';
import { SetPrimaryEmailCommand } from './commands/set-primary-email.command.js';

// import queries
import { GetEmailsQuery } from './queries/get-emails.query.js';

// import dtos
import { AddEmailDto } from './dto/add-email.dto.js';

// import application libraries
import { RateLimitGuard } from '@libs/common';
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';

// import interfaces
import type { RequestUser } from '../access/interfaces/request-user.js';

// Account-wide, not tied to any particular sign-in method
@ApiTags('Identity')
@Controller('auth/emails')
export class EmailsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List email addresses for the current account.' })
  listEmails(@CurrentUser() user: RequestUser) {
    return this.queryBus.execute(new GetEmailsQuery(user.id));
  }

  @Post()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Add a new email address to the current account.' })
  addEmail(@CurrentUser() user: RequestUser, @Body() dto: AddEmailDto) {
    return this.commandBus.execute(new AddEmailCommand(user.id, dto.email));
  }

  @Patch(':emailId/primary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Set an email address as the primary one.' })
  setPrimaryEmail(
    @CurrentUser() user: RequestUser,
    @Param('emailId', ParseUUIDPipe) emailId: string,
  ): Promise<void> {
    return this.commandBus.execute(
      new SetPrimaryEmailCommand(user.id, emailId),
    );
  }

  @Delete(':emailId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Remove an email address from the current account.',
  })
  removeEmail(
    @CurrentUser() user: RequestUser,
    @Param('emailId', ParseUUIDPipe) emailId: string,
  ): Promise<void> {
    return this.commandBus.execute(new RemoveEmailCommand(user.id, emailId));
  }
}
