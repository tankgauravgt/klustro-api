import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

// import controllers
import { ProjectController } from './project.controller.js';

// import handlers
import { CreateProjectHandler } from './commands/handlers/create-project.handler.js';
import { LeaveProjectHandler } from './commands/handlers/leave-project.handler.js';
import { ListProjectsHandler } from './queries/handlers/list-projects.handler.js';

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
  providers: [CreateProjectHandler, LeaveProjectHandler, ListProjectsHandler],
  exports: [TypeOrmModule],
})
export class ProjectModule {}
