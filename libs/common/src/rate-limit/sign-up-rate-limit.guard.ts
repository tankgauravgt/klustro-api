import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerOptions } from '@nestjs/throttler';
import { InjectThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';

// import services
import { AppConfigService } from '../config/app-config.service.js';

// Sign-up answers differently for an address that already has an account, so it is the one
// endpoint that can be used to look addresses up. It gets a much smaller budget than the rest.
export const DEFAULT_SIGNUP_LIMIT = 5;

export interface SignUpLimits {
  limit: number;
  // Milliseconds
  ttl: number;
}

const positiveNumber = (value: string | undefined): number | null => {
  const number = Number(value);
  return value !== undefined && Number.isFinite(number) && number > 0
    ? number
    : null;
};

/*
 * `SIGNUP_THROTTLE_LIMIT` per `SIGNUP_THROTTLE_TTL_SECONDS` (default 5 per the general window);
 * a missing or invalid value falls back to the default, never to "no limit".
 */
export function signUpLimits(config: AppConfigService): SignUpLimits {
  const seconds =
    positiveNumber(config.optional('SIGNUP_THROTTLE_TTL_SECONDS')) ??
    positiveNumber(config.optional('THROTTLE_TTL_SECONDS')) ??
    60;
  return {
    limit:
      positiveNumber(config.optional('SIGNUP_THROTTLE_LIMIT')) ??
      DEFAULT_SIGNUP_LIMIT,
    ttl: seconds * 1000,
  };
}

@Injectable()
export class SignUpRateLimitGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: AppConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected override handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    return super.handleRequest({
      ...requestProps,
      ...signUpLimits(this.config),
    });
  }
}
