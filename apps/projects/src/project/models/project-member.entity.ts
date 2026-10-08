import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { Index } from 'typeorm';
import { JoinColumn } from 'typeorm';
import { ManyToOne } from 'typeorm';
import { PrimaryGeneratedColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

// import models
import { Project } from './project.entity.js';

// import interfaces
import type { ProjectRole } from '../interfaces/project-role.js';

@Audited({
  name: 'project_member',
  scope: (member) => `project:${member.projectId}`,
})
@Entity({ name: 'project_members' })
@Index(['projectId', 'userId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class ProjectMember extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  @Column()
  projectId!: string;

  // Id from the auth service; deliberately no foreign key across services
  @Column()
  userId!: string;

  @Column({ type: 'varchar' })
  role!: ProjectRole;
}
