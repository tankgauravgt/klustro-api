import { ConflictException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';

// import application libraries
import { AuditService } from '@libs/governance';

// import models
import { ProjectMember } from '../models/project-member.entity.js';
import { Project } from '../models/project.entity.js';

export interface ProjectAccess {
  project: Project;
  membership: ProjectMember;
}

/*
 * Who may do what in a project. A person outside the project gets 404, so its existence is not
 * revealed; a member without the right gets 403 and a 'denied' audit record.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async requireMember(
    userId: string,
    projectId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ProjectAccess> {
    const membership = await manager
      .getRepository(ProjectMember)
      .findOne({ where: { projectId, userId }, relations: { project: true } });
    if (!membership?.project) {
      throw new NotFoundException('Project not found');
    }
    return { project: membership.project, membership };
  }

  async requireOwner(
    userId: string,
    projectId: string,
    action: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ProjectAccess> {
    let access: ProjectAccess;
    try {
      access = await this.requireMember(userId, projectId, manager);
    } catch (error) {
      if (error instanceof NotFoundException) {
        await this.audit.record({
          action,
          outcome: 'denied',
          entityType: 'project',
          entityId: projectId,
          metadata: { reason: 'not_a_member' },
        });
      }
      throw error;
    }
    if (access.membership.role !== 'owner') {
      await this.audit.record({
        action,
        outcome: 'denied',
        entityType: 'project',
        entityId: projectId,
        scope: `project:${projectId}`,
        metadata: { reason: 'not_an_owner' },
      });
      throw new ForbiddenException('Only project owners can do this');
    }
    return access;
  }

  // An archived project is read-only: only leaving, unarchiving and deleting remain
  assertActive(project: Project): void {
    if (project.archivedAt) {
      throw new ConflictException('Project is archived');
    }
  }
}
