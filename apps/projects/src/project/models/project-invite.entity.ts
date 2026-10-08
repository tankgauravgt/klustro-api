import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { JoinColumn } from 'typeorm';
import { ManyToOne } from 'typeorm';
import { PrimaryGeneratedColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

// import models
import { Project } from './project.entity.js';

@Audited({
  name: 'project_invite',
  redact: ['tokenHash'],
  scope: (invite) => `project:${invite.projectId}`,
})
@Entity({ name: 'project_invites' })
export class ProjectInvite extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  @Column()
  projectId!: string;

  // Only the hash is stored; the raw token exists solely inside the invite link
  @Column({ unique: true })
  tokenHash!: string;

  @Column()
  createdByUserId!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;
}
