import { afterEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

// import services
import { AppConfigService } from './app-config.service.js';

const serviceWith = (values: Record<string, string>): AppConfigService =>
  new AppConfigService(new ConfigService(values));

describe('AppConfigService', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns a configured value', () => {
    const config = serviceWith({ WEB_URL: 'https://app.example.com' });

    expect(config.get('WEB_URL')).toBe('https://app.example.com');
  });

  it('throws for a missing key instead of falling back', () => {
    vi.stubEnv('JWT_SECRET', undefined);
    vi.stubEnv('APPS_AUTH__GOOGLE_CLIENT_ID', undefined);
    const config = serviceWith({});

    expect(() => config.get('JWT_SECRET')).toThrow(/JWT_SECRET/);
    expect(() => config.get('APPS_AUTH__GOOGLE_CLIENT_ID')).toThrow(
      /APPS_AUTH__GOOGLE_CLIENT_ID/,
    );
  });

  describe('flag', () => {
    it.each(['1', 'true', 'TRUE', ' 1 '])('is on for %j', (value) => {
      expect(
        serviceWith({ USE_SQLITE_DATABASE: value }).flag('USE_SQLITE_DATABASE'),
      ).toBe(true);
    });

    it.each(['0', 'false', '', 'yes'])('is off for %j', (value) => {
      expect(
        serviceWith({ USE_SQLITE_DATABASE: value }).flag('USE_SQLITE_DATABASE'),
      ).toBe(false);
    });

    it('is off when the setting is missing, instead of throwing', () => {
      vi.stubEnv('USE_SQLITE_DATABASE', undefined);

      expect(serviceWith({}).flag('USE_SQLITE_DATABASE')).toBe(false);
    });
  });
});
