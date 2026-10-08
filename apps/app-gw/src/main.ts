// import application libraries
import { bootstrapApp } from '@libs/common';

// import modules
import { AppGwModule } from './app-gw.module.js';
import { ServiceSupervisor } from './service-supervisor.js';

// import others
import { mountProxies } from './proxies.js';

await bootstrapApp(AppGwModule, {
  title: 'Klustro API Gateway',
  description: 'Single entry point that forwards requests to the auth and projects services',
  listenAt: 'APPS_GW__URL',
  bodyParser: false,
  beforeListen: (app) => {
    mountProxies(app);
    app.get(ServiceSupervisor).startAll();
  },
});
