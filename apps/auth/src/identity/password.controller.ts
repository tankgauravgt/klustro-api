import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Patch } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';
import { RateLimitGuard } from '@libs/common';

// import guards, decorators and strategies
import { SessionCookieInterceptor } from '../access/interceptors/session-cookie.interceptor.js';

// import commands
import { SetPasswordCommand } from './commands/set-password.command.js';

// import dtos
import { SetPasswordDto } from './dto/set-password.dto.js';

// import interfaces
import type { AuthResult } from '../access/interfaces/auth-result.js';
import type { RequestUser } from '../access/interfaces/request-user.js';

@ApiTags('Identity')
@Controller('auth')
@UseInterceptors(SessionCookieInterceptor)
export class PasswordController {
  constructor(private readonly commandBus: CommandBus) {}

  @Patch('password/set')
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Set or change the password of the current account. The first password of an account made through Google or GitHub needs only the new one; changing an existing password also needs the current one.',
  })
  setPassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: SetPasswordDto,
  ): Promise<AuthResult> {
    return this.commandBus.execute(
      new SetPasswordCommand(user.id, dto.password, dto.currentPassword),
    );
  }
}
