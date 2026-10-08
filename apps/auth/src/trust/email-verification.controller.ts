import { Body } from '@nestjs/common';
import { Controller } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import commands
import { VerifyEmailCommand } from './commands/verify-email.command.js';

// import dtos
import { VerifyEmailDto } from './dto/verify-email.dto.js';

@ApiTags('Trust')
@Controller('auth')
export class EmailVerificationController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Activate an account with the token from its verification email.',
  })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.commandBus.execute(new VerifyEmailCommand(dto));
  }
}
