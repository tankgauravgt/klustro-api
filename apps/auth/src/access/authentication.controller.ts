import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { Res } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';
import { ACCESS_TOKEN_COOKIE } from '@libs/common';
import { RateLimitGuard } from '@libs/common';
import { SESSION_COOKIE_OPTIONS } from '@libs/common';

// import guards, decorators and strategies
import { SessionCookieInterceptor } from './interceptors/session-cookie.interceptor.js';

// import commands
import { LogoutCommand } from './commands/logout.command.js';
import { SignInCommand } from './commands/sign-in.command.js';

// import dtos
import { SignInDto } from './dto/sign-in.dto.js';

// import interfaces
import type { AuthResult } from './interfaces/auth-result.js';
import type { RequestUser } from './interfaces/request-user.js';

/*
 * Password sign-in and sign-out. Signing in sets the httpOnly session cookie; the token is not
 * in the response body.
 */
@ApiTags('Access')
@Controller('auth')
@UseInterceptors(SessionCookieInterceptor)
export class AuthenticationController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('signin')
  @UseGuards(RateLimitGuard)
  @ApiOperation({ summary: 'Sign in with a username or email and a password.' })
  signIn(@Body() dto: SignInDto): Promise<AuthResult> {
    return this.commandBus.execute(new SignInCommand(dto));
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke the current access token.' })
  @HttpCode(204)
  async logout(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    response.clearCookie(ACCESS_TOKEN_COOKIE, SESSION_COOKIE_OPTIONS);
    return this.commandBus.execute(
      new LogoutCommand(user.jti, new Date(user.exp * 1000)),
    );
  }
}
