import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { PrimaryGeneratedColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

// import interfaces
import type { MeshProvider } from '../interfaces/mesh-provider.js';

@Audited({ name: 'project', scope: (project) => `project:${project.id}` })
@Entity({ name: 'projects' })
export class Project extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  // Chosen once at creation; `update: false` makes TypeORM skip it on every save
  @Column({ type: 'varchar', update: false })
  meshProvider!: MeshProvider;
}
