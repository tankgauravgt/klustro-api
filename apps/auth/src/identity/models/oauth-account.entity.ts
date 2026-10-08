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
import { User } from './user.entity.js';

export type OAuthProvider = 'google' | 'github';

@Audited({ name: 'oauth_account', scope: (link) => `user:${link.userId}` })
@Entity({ name: 'oauth_accounts' })
@Index(['provider', 'providerAccountId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index(['userId', 'provider'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class OAuthAccount extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  provider!: OAuthProvider;

  @Column()
  providerAccountId!: string;

  @ManyToOne(() => User, (user) => user.oauthAccounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;
}
