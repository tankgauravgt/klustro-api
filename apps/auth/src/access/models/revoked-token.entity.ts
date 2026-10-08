import { Column } from 'typeorm';
import { Entity } from 'typeorm';
import { PrimaryColumn } from 'typeorm';

// import application libraries
import { Audited } from '@libs/governance';
import { GovernedEntity } from '@libs/governance';

/*
 * Reject list: JWTs are verified statelessly (signature + expiry).
 * A row here means that specific token (by jti) has been explicitly
 * revoked (e.g., logout) before its natural expiry.
 */
@Audited({ name: 'revoked_token' })
@Entity({ name: 'revoked_tokens' })
export class RevokedToken extends GovernedEntity {
  @PrimaryColumn()
  jti!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;
}
