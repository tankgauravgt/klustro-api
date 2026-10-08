import { CommandHandler } from '@nestjs/cqrs';
import { ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import commands
import { CreateProjectCommand } from '../create-project.command.js';

// import models
import { ProjectMember } from '../../models/project-member.entity.js';
import { Project } from '../../models/project.entity.js';

// import interfaces
import type { ProjectSummary } from '../../interfaces/project-summary.js';

// import others
import { toProjectSummary } from '../../mappers/project-summary.mapper.js';

@CommandHandler(CreateProjectCommand)
export class CreateProjectHandler implements ICommandHandler<
  CreateProjectCommand,
  ProjectSummary
> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  execute(command: CreateProjectCommand): Promise<ProjectSummary> {
    const { userId, dto } = command;

    return this.dataSource.transaction(async (manager) => {
      const projects = manager.getRepository(Project);
      const members = manager.getRepository(ProjectMember);

      const project = await projects.save(
        projects.create({ name: dto.name, meshProvider: dto.meshProvider }),
      );
      await members.save(
        members.create({ projectId: project.id, userId, role: 'owner' }),
      );

      return toProjectSummary(project, 'owner', 1);
    });
  }
}
