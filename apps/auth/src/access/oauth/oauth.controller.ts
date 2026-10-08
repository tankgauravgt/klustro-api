import { ConflictException } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { Query } from '@nestjs/common';
import { Redirect } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { Res } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Response } from 'express';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';
import { ACCESS_TOKEN_COOKIE } from '@libs/common';
import { AppConfigService } from '@libs/common';
import { RateLimitGuard } from '@libs/common';
import { SESSION_COOKIE_OPTIONS } from '@libs/common';
import { readCookie } from '@libs/common';

// import features
import { ConnectOAuthCommand } from '../../identity/commands/connect-oauth.command.js';
import { OAuthSignInCommand } from '../commands/oauth-sign-in.command.js';
import type { AuthResult } from '../interfaces/auth-result.js';
import type { OAuthAccessProvider } from '../interfaces/access-provider.js';
import type { OAuthProfile } from '../interfaces/oauth-profile.js';
import type { RequestUser } from '../interfaces/request-user.js';

// import dtos
import { OAuthCallbackQueryDto } from './dto/oauth-callback-query.dto.js';
import { OAuthLoginQueryDto } from './dto/oauth-login-query.dto.js';

// import services
import { AccessProviderFactory } from './services/access-provider.factory.js';
import { OAUTH_STATE_COOKIE } from './services/oauth-state.service.js';
import { OAUTH_STATE_COOKIE_OPTIONS } from './services/oauth-state.service.js';
import { OAuthStateService } from './services/oauth-state.service.js';
import type { OAuthAttempt } from './services/oauth-state.service.js';

// import others
import { safeReturnPath } from './utils/return-path.js';

interface ProviderSummary {
  name: string;
  kind: 'credentials' | 'oauth';
  // Where to send the browser to start, for `oauth` providers
  loginUrl?: string;
}

/*
 * One set of endpoints for every OAuth access provider (`:provider` is `google`, `github`, ...).
 * The browser is redirected to the provider and comes back to the callback, where this server
 * trades the code for the person's identity using its client secret, sets the session cookie
 * and sends the browser on to the web app. No code or token ever reaches page JavaScript.
 * Failures send the browser back to the web app with `?authError=<reason>`.
 */
@ApiTags('Access')
@Controller('auth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly providers: AccessProviderFactory,
    private readonly states: OAuthStateService,
    private readonly commandBus: CommandBus,
    private readonly config: AppConfigService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'The ways of signing in that this server offers.' })
  list(): ProviderSummary[] {
    return this.providers.list().map((provider) => ({
      name: provider.name,
      kind: provider.kind,
      ...(provider.kind === 'oauth' && {
        loginUrl: `/auth/${provider.name}/login`,
      }),
    }));
  }

  @Get(':provider/login')
  @UseGuards(RateLimitGuard)
  @Redirect()
  @ApiOperation({
    summary: 'Start signing in with an OAuth provider (redirects to it).',
  })
  login(
    @Param('provider') name: string,
    @Query() query: OAuthLoginQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): { url: string } {
    return this.begin(name, response, {
      mode: 'signin',
      returnPath: safeReturnPath(query.returnUrl),
    });
  }

  @Get(':provider/connect')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @Redirect()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Connect an OAuth provider to the signed-in account (redirects to it).',
  })
  connect(
    @Param('provider') name: string,
    @Query() query: OAuthLoginQueryDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): { url: string } {
    return this.begin(name, response, {
      mode: 'connect',
      userId: user.id,
      returnPath: safeReturnPath(query.returnUrl),
    });
  }

  @Get(':provider/callback')
  @UseGuards(RateLimitGuard)
  @Redirect()
  @ApiOperation({
    summary:
      'Where the provider sends the browser back; completes the sign-in.',
  })
  async callback(
    @Param('provider') name: string,
    @Query() query: OAuthCallbackQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string }> {
    const provider = this.providers.oauth(name);
    const cookie = readCookie(request, OAUTH_STATE_COOKIE);
    // An attempt can be finished once: the cookie is gone whatever happens next
    const { maxAge: _maxAge, ...clearOptions } = OAUTH_STATE_COOKIE_OPTIONS;
    response.clearCookie(OAUTH_STATE_COOKIE, clearOptions);

    if (query.error) {
      return this.failure(
        query.error === 'access_denied' ? 'access_denied' : 'failed',
      );
    }

    try {
      const attempt = this.states.finish(cookie, query.state, provider.name);
      if (!query.code) {
        throw new UnauthorizedException('No authorization code');
      }
      const profile = await provider.fetchProfile({
        code: query.code,
        redirectUri: this.callbackUrl(provider),
        codeVerifier: attempt.codeVerifier,
      });
      await this.complete(attempt, profile, response);
      return { url: this.frontendUrl(attempt.returnPath ?? '/projects') };
    } catch (error) {
      return this.failure(this.failureReason(error, provider.name));
    }
  }

  // Links the provider account to the signed-in user, or signs in and sets the session cookie
  private async complete(
    attempt: OAuthAttempt,
    profile: OAuthProfile,
    response: Response,
  ): Promise<void> {
    if (attempt.mode === 'connect' && attempt.userId) {
      await this.commandBus.execute(
        new ConnectOAuthCommand(attempt.userId, profile),
      );
      return;
    }
    const session: AuthResult = await this.commandBus.execute(
      new OAuthSignInCommand(profile),
    );
    response.cookie(
      ACCESS_TOKEN_COOKIE,
      session.accessToken,
      SESSION_COOKIE_OPTIONS,
    );
  }

  private failureReason(error: unknown, providerName: string): string {
    if (error instanceof ConflictException) {
      return 'conflict';
    }
    if (error instanceof UnauthorizedException) {
      return 'sign_in_failed';
    }
    this.logger.error(
      `${providerName} sign-in failed`,
      error instanceof Error ? error.stack : String(error),
    );
    return 'failed';
  }

  private begin(
    name: string,
    response: Response,
    attempt: Omit<OAuthAttempt, 'provider'>,
  ): { url: string } {
    const provider = this.providers.oauth(name);
    const started = this.states.start({ ...attempt, provider: provider.name });
    response.cookie(
      OAUTH_STATE_COOKIE,
      started.cookie,
      OAUTH_STATE_COOKIE_OPTIONS,
    );

    return {
      url: provider.authorizationUrl({
        redirectUri: this.callbackUrl(provider),
        state: started.state,
        codeChallenge: started.codeChallenge,
      }),
    };
  }

  // The address registered with the provider as the redirect URI
  private callbackUrl(provider: OAuthAccessProvider): string {
    const base = this.config.get('APPS_GW__URL').replace(/\/+$/, '');
    return `${base}/auth/${provider.name}/callback`;
  }

  private frontendUrl(path: string): string {
    return `${this.config.get('WEB_URL').replace(/\/+$/, '')}${path}`;
  }

  private failure(reason: string): { url: string } {
    return { url: this.frontendUrl(`/?authError=${reason}`) };
  }
}
