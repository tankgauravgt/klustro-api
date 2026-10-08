import { Column } from 'typeorm';
import { Index } from 'typeorm';
import { Entity } from 'typeorm';
import { JoinColumn } from 'typeorm';
import { ManyToOne } from 'typeorm';
import { PrimaryGeneratedColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

// import models
import { User } from './user.entity.js';

@Audited({ name: 'email', scope: (email) => `user:${email.userId}` })
@Entity({ name: 'emails' })
@Index(['email'], { unique: true, where: '"deletedAt" IS NULL' })
export class Email extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @Column({ default: false })
  isPrimary!: boolean;

  // True for OAuth-provided emails or after verification flow confirms it
  @Column({ default: false })
  isVerified!: boolean;

  // The provider ("google", "github") whose connection supplied this address, or null for an
  // address the person added themselves
  @Column({ type: 'varchar', nullable: true })
  provider!: string | null;

  @ManyToOne(() => User, (user) => user.emails, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;
}
