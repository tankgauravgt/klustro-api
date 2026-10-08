import { Module } from '@nestjs/common';

// import application libraries
import { AppConfigModule } from '@libs/common';

// import controllers
import { WipeDbController } from './wipe-db.controller.js';

// import services
import { ServiceSupervisor } from './service-supervisor.js';

// Requests for the services are forwarded (see proxies.ts); the gateway answers the rest itself
@Module({
  imports: [AppConfigModule],
  controllers: [WipeDbController],
  providers: [ServiceSupervisor],
})
export class AppGwModule {}
