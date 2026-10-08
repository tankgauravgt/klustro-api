import type { INestApplication } from '@nestjs/common';

// import services
import type { AppConfigService } from '../config/app-config.service.js';

/*
 * What `TRUST_PROXY` means, in the terms Express uses for `trust proxy`:
 *   unset, "", "0", "false"  the server is reached directly: the address of the connection is the client
 *   a number, e.g. "1"       that many proxies sit in front: the client is the address they report
 *   "true"                   believe any X-Forwarded-For (only safe if nothing can reach the server
 *                            except through the proxy)
 *   anything else            addresses or subnets of the proxies to believe, e.g. "loopback, 10.0.0.0/8"
 */
export function parseTrustProxy(
  value: string | undefined,
): boolean | number | string {
  const setting = value?.trim() ?? '';
  if (setting === '' || setting === '0' || setting.toLowerCase() === 'false') {
    return false;
  }
  if (setting.toLowerCase() === 'true') {
    return true;
  }
  return /^\d+$/.test(setting) ? Number(setting) : setting;
}

/*
 * Without this, behind a load balancer every request seems to come from the balancer: the rate
 * limit would count everyone as one client and the audit trail would record its address.
 */
export function applyTrustProxy(
  app: INestApplication,
  config: AppConfigService,
): void {
  const trust = parseTrustProxy(config.optional('TRUST_PROXY'));
  if (trust !== false) {
    app.getHttpAdapter().getInstance().set('trust proxy', trust);
  }
}
