// import application libraries
import { bootstrapApp } from '@libs/common';

// import modules
import { ProjectsModule } from './projects.module.js';

await bootstrapApp(ProjectsModule, {
  title: 'Klustro Projects API',
  description: 'OpenAPI documentation for the Klustro projects service',
  publishAs: 'projects',
});
