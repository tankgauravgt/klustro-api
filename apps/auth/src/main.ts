// import application libraries
import { bootstrapApp } from '@libs/common';

// import modules
import { AuthModule } from './auth.module.js';

await bootstrapApp(AuthModule, {
  title: 'Klustro Auth API',
  description: 'OpenAPI documentation for the Klustro authentication service',
  publishAs: 'auth',
});
