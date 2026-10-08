import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { ConfigService } from '@nestjs/config';

// import services
import { AppConfigService } from '../config/app-config.service.js';
import { DEFAULT_SIGNUP_LIMIT } from './sign-up-rate-limit.guard.js';
import { signUpLimits } from './sign-up-rate-limit.guard.js';

const configWith = (values: Record<string, string>) =>
  new AppConfigService(new ConfigService(values));

describe('signUpLimits', () => {
  it('uses the sign-up settings when they are given', () => {
    const limits = signUpLimits(
      configWith({
        SIGNUP_THROTTLE_LIMIT: '3',
        SIGNUP_THROTTLE_TTL_SECONDS: '30',
        THROTTLE_TTL_SECONDS: '60',
      }),
    );

    expect(limits).toEqual({ limit: 3, ttl: 30_000 });
  });

  it('is far stricter than the general limit when nothing is set', () => {
    const limits = signUpLimits(configWith({ THROTTLE_TTL_SECONDS: '60' }));

    expect(limits.limit).toBe(DEFAULT_SIGNUP_LIMIT);
    expect(DEFAULT_SIGNUP_LIMIT).toBeLessThan(20);
  });

  it('takes the window from the general setting unless sign-up has its own', () => {
    expect(signUpLimits(configWith({ THROTTLE_TTL_SECONDS: '120' })).ttl).toBe(
      120_000,
    );
  });

  it.each(['0', '-1', 'abc', ''])(
    'falls back to the default for the invalid value %j, never to no limit',
    (value) => {
      const limits = signUpLimits(
        configWith({
          SIGNUP_THROTTLE_LIMIT: value,
          THROTTLE_TTL_SECONDS: '60',
        }),
      );

      expect(limits.limit).toBe(DEFAULT_SIGNUP_LIMIT);
    },
  );

  it('falls back to a minute when no window is configured at all', () => {
    expect(signUpLimits(configWith({})).ttl).toBe(60_000);
  });
});
