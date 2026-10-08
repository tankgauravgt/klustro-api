import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { PrimaryGeneratedColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

// Only the hash is stored; the raw token exists in the mailed link alone
@Audited({
  name: 'email_verification_token',
  redact: ['tokenHash'],
  scope: (token) => `user:${token.userId}`,
})
@Entity({ name: 'email_verification_tokens' })
export class EmailVerificationToken extends GovernedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @Column({ unique: true })
  tokenHash!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ default: false })
  used!: boolean;
}
