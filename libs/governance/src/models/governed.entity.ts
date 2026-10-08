import { Column } from 'typeorm';
import { CreateDateColumn } from 'typeorm';
import { DeleteDateColumn } from 'typeorm';
import { UpdateDateColumn } from 'typeorm';

/*
 * Base for every business record. Rows are never hard-deleted: `deletedAt`
 * marks removal (queries skip such rows by default), and the *By columns are
 * stamped from the request context so each row names who last touched it.
 */
export abstract class GovernedEntity {
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true, update: false })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  deletedBy!: string | null;
}
