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

// import commands
import { CreateProjectCommand } from './commands/create-project.command.js';
import { LeaveProjectCommand } from './commands/leave-project.command.js';

// import queries
import { ListProjectsQuery } from './queries/list-projects.query.js';

// import dtos
import { CreateProjectDto } from './dto/create-project.dto.js';

// import interfaces
import type { ProjectSummary } from './interfaces/project-summary.js';

@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a project. The creator becomes its owner.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectSummary> {
    return this.commandBus.execute(new CreateProjectCommand(user.id, dto));
  }

  @Get()
  @ApiOperation({ summary: 'List the projects the current user has joined.' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ProjectSummary[]> {
    return this.queryBus.execute(new ListProjectsQuery(user.id));
  }

  @Delete(':projectId/membership')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Leave a project. The project is deleted when its last member leaves.',
  })
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<void> {
    return this.commandBus.execute(new LeaveProjectCommand(user.id, projectId));
  }
}
