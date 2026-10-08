import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';

// import features
import type { AccessProvider } from '../../interfaces/access-provider.js';
import type { OAuthAccessProvider } from '../../interfaces/access-provider.js';

// import others
import { ACCESS_PROVIDERS } from '../access-providers.token.js';

/*
 * Finds an access provider by the name in the URL. Adding a provider means writing its class
 * and listing it in `IdentityModule`; the endpoints do not change.
 */
@Injectable()
export class AccessProviderFactory {
  private readonly providers = new Map<string, AccessProvider>();

  constructor(@Inject(ACCESS_PROVIDERS) providers: AccessProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }
  }

  list(): AccessProvider[] {
    return [...this.providers.values()];
  }

  oauth(name: string): OAuthAccessProvider {
    const provider = this.providers.get(name);
    if (provider?.kind !== 'oauth') {
      throw new NotFoundException(`Unknown sign-in provider "${name}"`);
    }
    return provider as OAuthAccessProvider;
  }
}
