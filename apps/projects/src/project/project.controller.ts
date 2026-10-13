import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Delete } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Patch } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { Query } from '@nestjs/common';
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
import { DeleteProjectCommand } from './commands/delete-project.command.js';
import { LeaveProjectCommand } from './commands/leave-project.command.js';
import { SetProjectArchivedCommand } from './commands/set-project-archived.command.js';
import { UpdateProjectCommand } from './commands/update-project.command.js';

// import queries
import { GetProjectQuery } from './queries/get-project.query.js';
import { ListProjectsQuery } from './queries/list-projects.query.js';

// import dtos
import { CreateProjectDto } from './dto/create-project.dto.js';
import { ListProjectsDto } from './dto/list-projects.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';

// import interfaces
import type { ProjectPage } from './interfaces/project-page.js';
import type { ProjectSummary } from './interfaces/project-summary.js';

@ApiTags('Projects')
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
  @ApiOperation({
    summary:
      'List the projects the current user has joined, with search, filters, sorting and paging.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListProjectsDto,
  ): Promise<ProjectPage> {
    return this.queryBus.execute(new ListProjectsQuery(user.id, dto));
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Read one project the current user has joined.' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSummary> {
    return this.queryBus.execute(new GetProjectQuery(user.id, projectId));
  }

  @Patch(':projectId')
  @ApiOperation({ summary: 'Rename a project. Owners only.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectSummary> {
    return this.commandBus.execute(
      new UpdateProjectCommand(user.id, projectId, dto.name),
    );
  }

  @Delete(':projectId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a project with its members and invites. Owners only.',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<void> {
    return this.commandBus.execute(
      new DeleteProjectCommand(user.id, projectId),
    );
  }

  @Post(':projectId/archive')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Archive a project, which makes it read-only. Owners only.',
  })
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSummary> {
    return this.commandBus.execute(
      new SetProjectArchivedCommand(user.id, projectId, true),
    );
  }

  @Post(':projectId/unarchive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen an archived project. Owners only.' })
  unarchive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSummary> {
    return this.commandBus.execute(
      new SetProjectArchivedCommand(user.id, projectId, false),
    );
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
