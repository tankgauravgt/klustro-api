import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { Index } from 'typeorm';
import { PrimaryColumn } from 'typeorm';

// import interfaces
import type { AuditOutcome } from '../interfaces/audit-outcome.js';

/*
 * Append-only and hash-chained: each row stores the hash of the previous row,
 * so editing, removing or reordering history breaks verification. Updates and
 * deletes are also rejected by database triggers. JSON columns are kept as the
 * exact serialized text that was hashed.
 */
@Entity({ name: 'audit_logs' })
@Index(['scope', 'sequence'])
export class AuditLog {
  @PrimaryColumn({ type: 'integer' })
  sequence!: number;

  @Column({ unique: true })
  eventId!: string;

  @Column({ type: 'varchar' })
  occurredAt!: string;

  @Column({ type: 'varchar' })
  service!: string;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar' })
  outcome!: AuditOutcome;

  @Column({ type: 'varchar', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar' })
  actorType!: 'user' | 'system' | 'anonymous';

  @Column({ type: 'varchar', nullable: true })
  entityType!: string | null;

  @Column({ type: 'varchar', nullable: true })
  entityId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  scope!: string | null;

  @Column({ type: 'text', nullable: true })
  changes!: string | null;

  @Column({ type: 'text' })
  metadata!: string;

  @Column({ type: 'varchar' })
  previousHash!: string;

  @Column({ type: 'varchar' })
  hash!: string;
}
