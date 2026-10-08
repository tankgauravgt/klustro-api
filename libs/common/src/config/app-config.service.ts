import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ConfigKey =
  | 'APPS_GW__URL'
  | 'WEBSITES_PORT'
  | 'WEB_URL'
  | 'DB_PATH'
  | 'USE_SQLITE_DATABASE'
  | 'TRUST_PROXY'
  | 'JWT_SECRET'
  | 'JWT_EXPIRES_IN'
  | 'APPS_AUTH__GOOGLE_CLIENT_ID'
  | 'APPS_AUTH__GOOGLE_CLIENT_SECRET'
  | 'APPS_AUTH__GITHUB_CLIENT_ID'
  | 'APPS_AUTH__GITHUB_CLIENT_SECRET'
  | 'MAILGUN_SENDING_API_KEY'
  | 'MAILGUN_BASEURL'
  | 'THROTTLE_TTL_SECONDS'
  | 'THROTTLE_LIMIT'
  | 'SIGNUP_THROTTLE_LIMIT'
  | 'SIGNUP_THROTTLE_TTL_SECONDS';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get(key: ConfigKey): string {
    return this.config.getOrThrow<string>(key);
  }

  // A setting that may be left out
  optional(key: ConfigKey): string | undefined {
    return this.config.get<string>(key);
  }

  // An on/off switch: only "1" or "true" turns it on, and a missing one is off
  flag(key: ConfigKey): boolean {
    const value = this.config.get<string>(key)?.trim().toLowerCase();
    return value === '1' || value === 'true';
  }
}
