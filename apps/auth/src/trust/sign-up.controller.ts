import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import application libraries
import { SignUpRateLimitGuard } from '@libs/common';

// import guards, decorators and strategies
import { SessionCookieInterceptor } from '../access/interceptors/session-cookie.interceptor.js';

// import commands
import { SignUpCommand } from './commands/sign-up.command.js';

// import dtos
import { SignUpDto } from './dto/sign-up.dto.js';

// import interfaces
import type { SignUpResult } from './interfaces/sign-up-result.js';

// Creating an account; when the person turns out to own an existing one, signing in sets the cookie
@ApiTags('Trust')
@Controller('auth')
@UseInterceptors(SessionCookieInterceptor)
export class SignUpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('signup')
  @ApiOperation({
    summary:
      'Create an account. It cannot be used until its email is verified; an email already held by a verified account asks for that account’s password instead.',
  })
  @UseGuards(SignUpRateLimitGuard)
  signUp(@Body() dto: SignUpDto): Promise<SignUpResult> {
    return this.commandBus.execute(new SignUpCommand(dto));
  }
}
