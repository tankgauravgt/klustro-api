import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import commands
import { ForgotPasswordCommand } from './commands/forgot-password.command.js';
import { ResetPasswordCommand } from './commands/reset-password.command.js';

// import dtos
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

@ApiTags('Trust')
@Controller('auth')
export class PasswordRecoveryController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('password/forgot')
  @ApiOperation({
    summary: 'Request a password reset link for an email address.',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.commandBus.execute(new ForgotPasswordCommand(dto));
  }

  @Post('password/reset')
  @ApiOperation({ summary: 'Set a new password using a reset token.' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.commandBus.execute(new ResetPasswordCommand(dto));
  }
}
