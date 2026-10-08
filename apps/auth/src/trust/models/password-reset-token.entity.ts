import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { PrimaryGeneratedColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

@Audited({
  name: 'password_reset_token',
  redact: ['tokenHash'],
  scope: (token) => `user:${token.userId}`,
})
@Entity({ name: 'password_reset_tokens' })
export class PasswordResetToken extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  /*
   * Only the hash is stored; raw token is returned once and never persisted.
   * DB leak alone cannot be used to reset passwords.
   */
  @Column({ unique: true })
  tokenHash!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ default: false })
  used!: boolean;
}
