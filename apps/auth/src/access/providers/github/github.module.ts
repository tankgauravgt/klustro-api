import { Module } from '@nestjs/common';

// import services
import { GithubTokenVerifierService } from './services/github-token-verifier.service.js';

// import providers
import { GithubAccessProvider } from './github-access.provider.js';

// GitHub as an access provider; the shared OAuth endpoints are in `OAuthModule`
@Module({
  providers: [GithubTokenVerifierService, GithubAccessProvider],
  exports: [GithubAccessProvider],
})
export class GithubModule {}
