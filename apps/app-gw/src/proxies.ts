import type { INestApplication } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import httpProxy from 'http-proxy';

// import application libraries
import { resolveAddress } from '@libs/common';

// Each service's address is looked up on every request, so a restarted service is picked up at once
export interface Upstreams {
  auth: () => string | undefined;
  projects: () => string | undefined;
}

// Swagger's UI and its JSON/YAML documents, behind a service's prefix: /auth/docs, /auth/docs/x, /auth/docs-json
const DOCS_URL = /^\/(auth|projects)(\/docs(?:-json|-yaml)?(?=[/?]|$))/;

export function mountProxies(app: INestApplication): void {
  mountRoutes(app, {
    auth: () => resolveAddress('auth'),
    projects: () => resolveAddress('projects'),
  });
}

// Each service owns some path prefixes; everything else reaches the gateway's own routes
export function mountRoutes(app: INestApplication, upstreams: Upstreams): void {
  const routes = [
    // /__mock is the test-only consent page of the OAuth mock, served by auth; elsewhere it is a 404
    { prefixes: ['/auth', '/__mock'], target: upstreams.auth },
    { prefixes: ['/projects', '/invites'], target: upstreams.projects },
  ];
  const proxy = httpProxy.createProxyServer({ xfwd: true });

  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    const route = routes.find(({ prefixes }) =>
      prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
    );
    if (!route) {
      next();
      return;
    }

    // A service serves its Swagger UI at /docs, so the gateway's /auth/docs maps onto it
    req.url = (req.url ?? '').replace(DOCS_URL, '$2');

    const target = route.target();
    if (!target) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'The service is unavailable' }));
      return;
    }
    proxy.web(req, res, { target }, () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ message: 'The service is unavailable' }));
    });
  });
}
