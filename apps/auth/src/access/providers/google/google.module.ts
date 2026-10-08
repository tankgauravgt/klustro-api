import { Module } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

// import application libraries
import { AppConfigService } from '@libs/common';

// import services
import { GoogleTokenVerifierService } from './services/google-token-verifier.service.js';

// import providers
import { GoogleAccessProvider } from './google-access.provider.js';

// import others
import { GOOGLE_OAUTH_CLIENT } from './constants.js';

// Google as an access provider; the shared OAuth endpoints are in `OAuthModule`
@Module({
  providers: [
    {
      provide: GOOGLE_OAUTH_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new OAuth2Client(config.get('APPS_AUTH__GOOGLE_CLIENT_ID')),
    },
    GoogleTokenVerifierService,
    GoogleAccessProvider,
  ],
  exports: [GoogleAccessProvider],
})
export class GoogleModule {}
