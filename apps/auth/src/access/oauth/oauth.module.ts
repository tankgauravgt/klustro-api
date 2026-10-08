import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';

// import modules
import { GithubModule } from '../providers/github/github.module.js';
import { GoogleModule } from '../providers/google/google.module.js';

// import providers
import { GithubAccessProvider } from '../providers/github/github-access.provider.js';
import { GoogleAccessProvider } from '../providers/google/google-access.provider.js';
import { LocalAccessProvider } from '../providers/local/local-access.provider.js';

// import controllers
import { OAuthController } from './oauth.controller.js';

// import services
import { AccessProviderFactory } from './services/access-provider.factory.js';
import { OAuthStateService } from './services/oauth-state.service.js';

// import others
import { ACCESS_PROVIDERS } from './access-providers.token.js';

// The sign-in providers the server offers, and the endpoints that drive the OAuth ones
@Module({
  // The state cookie is signed with its own key (see OAuthStateService), so no default secret here
  imports: [CqrsModule, JwtModule.register({}), GoogleModule, GithubModule],
  controllers: [OAuthController],
  providers: [
    LocalAccessProvider,
    {
      provide: ACCESS_PROVIDERS,
      inject: [LocalAccessProvider, GoogleAccessProvider, GithubAccessProvider],
      useFactory: (...providers: unknown[]) => providers,
    },
    AccessProviderFactory,
    OAuthStateService,
  ],
})
export class OAuthModule {}
