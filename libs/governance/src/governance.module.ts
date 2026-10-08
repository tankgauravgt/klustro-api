import { DynamicModule } from '@nestjs/common';
import { MiddlewareConsumer } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestModule } from '@nestjs/common';
import { OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import services
import { AuditService } from './services/audit.service.js';
import { RequestContextService } from './services/request-context.service.js';

// import models
import { AuditLog } from './models/audit-log.entity.js';
import { GovernedEntity } from './models/governed.entity.js';

// import others
import { GOVERNANCE_SERVICE } from './constants.js';
import { AuditContextInterceptor } from './interceptors/audit-context.interceptor.js';
import { RequestContextMiddleware } from './middleware/request-context.middleware.js';
import { GovernanceSubscriber } from './subscribers/governance.subscriber.js';

@Module({})
export class GovernanceModule implements NestModule, OnModuleInit {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  static forRoot(service: string): DynamicModule {
    return {
      module: GovernanceModule,
      global: true,
      imports: [TypeOrmModule.forFeature([AuditLog])],
      providers: [
        { provide: GOVERNANCE_SERVICE, useValue: service },
        RequestContextService,
        AuditService,
        GovernanceSubscriber,
        { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
      ],
      exports: [AuditService, RequestContextService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }

  /*
   * Database-level backstop (SQLite syntax): even code that bypasses the ORM
   * cannot rewrite the audit log or hard-delete a governed record.
   */
  async onModuleInit(): Promise<void> {
    const guard = (table: string, event: string, message: string) =>
      this.dataSource.query(
        `CREATE TRIGGER IF NOT EXISTS "governance_${event}_${table}" ` +
          `BEFORE ${event.toUpperCase()} ON "${table}" ` +
          `BEGIN SELECT RAISE(ABORT, '${message}'); END`,
      );

    await guard('audit_logs', 'update', 'audit_logs is append-only');
    await guard('audit_logs', 'delete', 'audit_logs is append-only');

    for (const metadata of this.dataSource.entityMetadatas) {
      if (
        typeof metadata.target === 'function' &&
        metadata.target.prototype instanceof GovernedEntity
      ) {
        await guard(
          metadata.tableName,
          'delete',
          'hard deletes are forbidden; soft delete instead',
        );
      }
    }
  }
}
