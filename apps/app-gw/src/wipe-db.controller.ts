import { Controller } from '@nestjs/common';
import { HttpCode } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';

// import services
import { ServiceSupervisor } from './service-supervisor.js';

// The services keep their databases in memory, so restarting them empties those databases.
// Development only: anyone who can reach the gateway can call it.
@ApiTags('Development')
@Controller()
export class WipeDbController {
  constructor(private readonly supervisor: ServiceSupervisor) {}

  @Post('wipe-db')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restart all services, which empties their in-memory databases.',
  })
  async wipeDb(): Promise<{ restarted: string[] }> {
    return { restarted: await this.supervisor.restartAll() };
  }
}
