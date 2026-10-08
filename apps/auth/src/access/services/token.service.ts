import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { OnModuleDestroy } from '@nestjs/common';
import { OnModuleInit } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import { Repository } from 'typeorm';

// import application libraries
import { inDatabaseScope } from '@libs/common';

// import models
import { RevokedToken } from '../models/revoked-token.entity.js';
import { User } from '../../identity/models/user.entity.js';

export interface AccessTokenPayload {
  sub: string;
  jti: string;
  tokenVersion: number;
  exp: number;
}

// Retired entries are pruned this often; an entry only matters until its token would have expired anyway
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class TokenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenService.name);
  private pruneTimer?: NodeJS.Timeout;

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(RevokedToken)
    private readonly revokedTokens: Repository<RevokedToken>,
  ) {}

  onModuleInit(): void {
    this.pruneTimer = setInterval(() => {
      // Its own database scope, like a request, so it takes turns with the requests
      inDatabaseScope(() => this.pruneExpired()).catch((error: unknown) =>
        this.logger.error(
          'Pruning the reject list failed',
          error instanceof Error ? error.stack : String(error),
        ),
      );
    }, PRUNE_INTERVAL_MS);
    // Never keeps the process alive on its own
    this.pruneTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.pruneTimer);
  }

  // The one place every sign-in path ends up, so a deactivated account can never get a session
  issue(user: User): string {
    if (!user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }
    const payload = {
      sub: user.id,
      jti: randomUUID(),
      tokenVersion: user.tokenVersion,
    };
    return this.jwtService.sign(payload);
  }

  isRevoked(jti: string): Promise<boolean> {
    return this.revokedTokens.exists({ where: { jti } });
  }

  async revoke(jti: string, expiresAt: Date): Promise<void> {
    await this.revokedTokens.save(
      this.revokedTokens.create({ jti, expiresAt }),
    );
  }

  // Retire reject-list entries whose underlying token has expired (soft delete)
  async pruneExpired(): Promise<void> {
    await this.revokedTokens.softRemove(
      await this.revokedTokens.find({
        where: { expiresAt: LessThan(new Date()) },
      }),
    );
  }
}
