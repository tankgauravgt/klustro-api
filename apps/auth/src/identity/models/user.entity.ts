import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { Index } from 'typeorm';
import { OneToMany } from 'typeorm';
import { PrimaryGeneratedColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

// import models
/*
 * import type only: used as TS array-element types. Relation target is a
 * string to avoid ESM circular import (Email/OAuthAccount import User).
 */
import type { Email } from './email.entity.js';
import type { OAuthAccount } from './oauth-account.entity.js';

@Audited({
  name: 'user',
  redact: ['passwordHash'],
  scope: (user) => `user:${user.id}`,
})
@Entity({ name: 'users' })
@Index(['username'], {
  unique: true,
  where: '"deletedAt" IS NULL AND "isActive" = 1',
})
export class User extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Lowercase, unique among active accounts (enforced by the index above). A removed or
  // deactivated account frees its name immediately.
  @Column()
  username!: string;

  @Column({ nullable: true, type: 'varchar' })
  firstName!: string | null;

  @Column({ nullable: true, type: 'varchar' })
  lastName!: string | null;

  // Denormalized cache of primary Email; source of truth is emails table
  @Column({ nullable: true, type: 'varchar' })
  email!: string | null;

  // Null until user sets password; true after first-time OAuth signup
  @Column({ nullable: true, type: 'varchar' })
  passwordHash!: string | null;

  @Column({ default: false })
  requiresPasswordSetup!: boolean;

  @Column({ default: true })
  isActive!: boolean;

  // True once the primary email is proven (by a provider, later by a mailed link). Until then
  // the account cannot sign in or call the API, so a pending account never owns any data.
  @Column({ default: false })
  isEmailVerified!: boolean;

  // Bumped on password change; included in JWTs to invalidate all prior tokens
  @Column({ default: 0 })
  tokenVersion!: number;

  @OneToMany('Email', 'user')
  emails!: Email[];

  @OneToMany('OAuthAccount', 'user')
  oauthAccounts!: OAuthAccount[];
}
