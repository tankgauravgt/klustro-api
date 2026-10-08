import { Global } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

// import services
import { AppConfigService } from '../config/app-config.service.js';

/*
 * Request limits come from `.env`. Routes opt in with `@UseGuards(RateLimitGuard)`, so paced
 * endpoints such as polling are not affected.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            ttl: Number(config.get('THROTTLE_TTL_SECONDS')) * 1000,
            limit: Number(config.get('THROTTLE_LIMIT')),
          },
        ],
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
