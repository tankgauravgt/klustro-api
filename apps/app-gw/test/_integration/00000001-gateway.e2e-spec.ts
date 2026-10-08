import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// import applications
import { AppGwModule } from '@apps/app-gw';

// import others
import { mountRoutes } from '../../src/proxies.js';

interface Received {
  method: string;
  url: string;
  authorization?: string;
  cookie?: string;
  forwardedFor?: string;
  body: string;
}

interface Upstream {
  url: string;
  received: Received[];
  close(): Promise<void>;
}

// A stand-in for a service: records what arrives and answers with its name
async function startUpstream(name: string): Promise<Upstream> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        forwardedFor: req.headers['x-forwarded-for'] as string | undefined,
        body,
      });
      if (req.url?.startsWith(`/${name}/signin`)) {
        res.setHeader('set-cookie', 'access_token=abc; Path=/; HttpOnly');
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ service: name }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => closeServer(server),
  };
}

// An address that nothing listens on: a service that is down
async function deadUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await closeServer(server);
  return `http://127.0.0.1:${port}`;
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

// The gateway as main.ts builds it: bodies unread, proxies mounted before the app starts
async function startGateway(upstreams: {
  auth: string;
  projects: string;
}): Promise<INestApplication> {
  const app = await NestFactory.create(AppGwModule, { bodyParser: false });
  mountRoutes(app, {
    auth: () => upstreams.auth,
    projects: () => upstreams.projects,
  });
  await app.init();
  return app;
}

describe('API gateway (e2e)', () => {
  let auth: Upstream;
  let projects: Upstream;
  let app: INestApplication;
  let server: HttpServer;
  let downApp: INestApplication;

  beforeAll(async () => {
    auth = await startUpstream('auth');
    projects = await startUpstream('projects');
    app = await startGateway({ auth: auth.url, projects: projects.url });
    server = app.getHttpServer();
    downApp = await startGateway({
      auth: await deadUrl(),
      projects: projects.url,
    });
  });

  afterAll(async () => {
    await app.close();
    await downApp.close();
    await auth.close();
    await projects.close();
  });

  beforeEach(() => {
    auth.received.length = 0;
    projects.received.length = 0;
  });

  it('forwards /auth requests to the auth service, with method, query, cookies and headers intact', async () => {
    const res = await request(server)
      .post('/auth/signin?next=/home')
      .set('Cookie', 'theme=dark')
      .set('Authorization', 'Bearer token-1')
      .send({ identifier: 'jane', password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ service: 'auth' });
    expect(projects.received).toHaveLength(0);
    expect(auth.received).toHaveLength(1);
    expect(auth.received[0]).toMatchObject({
      method: 'POST',
      url: '/auth/signin?next=/home',
      cookie: 'theme=dark',
      authorization: 'Bearer token-1',
    });
  });

  it('delivers the request body to the service unchanged', async () => {
    await request(server)
      .post('/auth/signin')
      .send({ identifier: 'jane', password: 'secret123' });

    expect(JSON.parse(auth.received[0].body)).toEqual({
      identifier: 'jane',
      password: 'secret123',
    });
  });

  it('forwards /projects and /invites requests to the projects service', async () => {
    const list = await request(server).get('/projects');
    const accept = await request(server).post('/invites/abc123/accept');

    expect(list.body).toEqual({ service: 'projects' });
    expect(accept.body).toEqual({ service: 'projects' });
    expect(projects.received.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /projects',
      'POST /invites/abc123/accept',
    ]);
    expect(auth.received).toHaveLength(0);
  });

  it('passes the Set-Cookie from the service back to the caller', async () => {
    const res = await request(server)
      .post('/auth/signin')
      .send({ identifier: 'jane', password: 'secret123' });

    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('access_token=abc')]),
    );
  });

  it('tells the service the caller address in X-Forwarded-For', async () => {
    await request(server).get('/auth/me');

    expect(auth.received[0].forwardedFor).toMatch(/127\.0\.0\.1|::1/);
  });

  it('answers 404 itself for paths no service owns, without forwarding them', async () => {
    const res = await request(server).get('/nope');

    expect(res.status).toBe(404);
    expect(auth.received).toHaveLength(0);
    expect(projects.received).toHaveLength(0);
  });

  it('answers 502 when the service it routes to is down', async () => {
    const res = await request(downApp.getHttpServer()).get('/auth/providers');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: 'The service is unavailable' });
    expect(projects.received).toHaveLength(0);
  });
});
