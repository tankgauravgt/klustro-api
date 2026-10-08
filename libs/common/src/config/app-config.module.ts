import { Global } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// import services
import { AppConfigService } from './app-config.service.js';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ cache: true, envFilePath: '.env' })],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
