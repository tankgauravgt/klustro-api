import { Controller } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import application libraries
import { CurrentUser } from '@libs/common';
import { JwtAuthGuard } from '@libs/common';

// import interfaces
import type { RequestUser } from './interfaces/request-user.js';

@ApiTags('Access')
@Controller('auth')
export class SessionController {
  @Get('session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Check that a token is still valid (not revoked, account active and verified). Used by the projects service.',
  })
  session(@CurrentUser() user: RequestUser): { id: string } {
    return { id: user.id };
  }
}
