import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DynamicModule } from '@nestjs/common';
import { MiddlewareConsumer } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestModule } from '@nestjs/common';
import { OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// import services
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseScopeMiddleware } from './database-scope.middleware.js';
import { serializeTransactions } from './transaction-gate.js';

// DB_PATH is a folder holding `<service>.sqlite`, or `:memory:` for throwaway databases
const databaseFor = (service: string, path: string): string => {
  if (path === ':memory:') {
    return path;
  }
  mkdirSync(path, { recursive: true });
  return join(path, `${service}.sqlite`);
};

/*
 * With `USE_SQLITE_DATABASE=1` the database is SQLite, which has a single connection that every
 * request would otherwise share, transactions included (see transaction-gate.ts). Then database
 * work takes turns per request. With 0 (the default) nothing is changed.
 */
@Module({})
export class DatabaseModule implements NestModule, OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    if (this.config.flag('USE_SQLITE_DATABASE')) {
      consumer.apply(DatabaseScopeMiddleware).forRoutes('*');
    }
  }

  onModuleInit(): void {
    if (this.config.flag('USE_SQLITE_DATABASE')) {
      serializeTransactions(this.dataSource);
    }
  }

  static forRoot(service: string): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => ({
            type: 'better-sqlite3',
            database: databaseFor(service, config.get('DB_PATH')),
            autoLoadEntities: true,
            synchronize: true,
          }),
        }),
      ],
    };
  }
}
