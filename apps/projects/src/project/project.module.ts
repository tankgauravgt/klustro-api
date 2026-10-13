import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

// import controllers
import { ProjectController } from './project.controller.js';

// import handlers
import { CreateProjectHandler } from './commands/handlers/create-project.handler.js';
import { DeleteProjectHandler } from './commands/handlers/delete-project.handler.js';
import { GetProjectHandler } from './queries/handlers/get-project.handler.js';
import { LeaveProjectHandler } from './commands/handlers/leave-project.handler.js';
import { ListProjectsHandler } from './queries/handlers/list-projects.handler.js';
import { SetProjectArchivedHandler } from './commands/handlers/set-project-archived.handler.js';
import { UpdateProjectHandler } from './commands/handlers/update-project.handler.js';

// import services
import { ProjectAccessService } from './services/project-access.service.js';

// import models
import { ProjectInvite } from './models/project-invite.entity.js';
import { ProjectMember } from './models/project-member.entity.js';
import { Project } from './models/project.entity.js';

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Project, ProjectMember, ProjectInvite]),
  ],
  controllers: [ProjectController],
  providers: [
    CreateProjectHandler,
    DeleteProjectHandler,
    GetProjectHandler,
    LeaveProjectHandler,
    ListProjectsHandler,
    SetProjectArchivedHandler,
    UpdateProjectHandler,
    ProjectAccessService,
  ],
  exports: [TypeOrmModule, ProjectAccessService],
})
export class ProjectModule {}
