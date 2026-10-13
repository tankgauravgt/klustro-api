import { afterAll } from 'vitest';
import { afterEach } from 'vitest';
import { beforeAll } from 'vitest';
import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// import application libraries
import { AppConfigService } from '@libs/common';
import { publishAddress } from '@libs/common';
import { resolveAddress } from '@libs/common';
import { unpublishAddress } from '@libs/common';

// import applications
import { ProjectsModule } from '@apps/projects';
import { AuthSessionService } from '../../src/identity/index.js';

interface Card {
  id: string;
  username: string;
  displayName: string;
}

interface Recorded {
  method?: string;
  url?: string;
  authorization?: string;
  body: { ids: string[] };
}

type Reply = (req: IncomingMessage, res: ServerResponse, body: string) => void;

/**
 * Covers how member names reach GET /projects/:id/members: a small real http server plays the
 * auth service, so the lookup travels over a real socket exactly as it does in production.
 * Names are a nicety, so every way auth can fail must leave the member list intact.
 */
describe('Member names from the auth service (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let jwt: JwtService;
  let counter = 0;

  let fakeAuth: Server;
  let fakeAuthUrl: string;
  let previousAuthAddress: string | undefined;
  let received: Recorded[] = [];
  // The directory the fake auth service knows about, and how it answers the next request
  let accounts: Card[] = [];
  let reply: Reply;

  const uid = (prefix = 'u'): string => `${prefix}-${++counter}`;
  const auth = (userId: string) => ({
    Authorization: `Bearer ${jwt.sign({ sub: userId })}`,
  });
  const cardFor = (id: string): Card => ({
    id,
    username: `name-${id}`,
    displayName: `Display ${id}`,
  });

  // Answers with every known account among the requested ids
  const answerFromAccounts: Reply = (_req, res, raw) => {
    const { ids } = JSON.parse(raw) as { ids: string[] };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(accounts.filter((card) => ids.includes(card.id))));
  };

  beforeAll(async () => {
    fakeAuth = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        let ids: string[] = [];
        try {
          ids = (JSON.parse(raw) as { ids: string[] }).ids;
        } catch {
          // a malformed request is recorded with no ids
        }
        received.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: { ids },
        });
        if (req.method === 'POST' && req.url === '/auth/users/lookup') {
          reply(req, res, raw);
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) =>
      fakeAuth.listen(0, '127.0.0.1', resolve),
    );
    fakeAuthUrl = `http://127.0.0.1:${(fakeAuth.address() as AddressInfo).port}`;

    // The registry is a tmp directory shared by every process, so put back whatever was there
    previousAuthAddress = resolveAddress('auth');
    publishAddress('auth', fakeAuthUrl);

    const moduleRef = await Test.createTestingModule({
      imports: [ProjectsModule],
    })
      .overrideProvider(AuthSessionService)
      .useValue({
        verify: async (token: string) => ({ id: jwt.decode(token).sub }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0);
    server = app.getHttpServer();
    jwt = new JwtService({
      secret: moduleRef.get(AppConfigService).get('JWT_SECRET'),
    });
  });

  afterAll(async () => {
    await app.close();
    if (previousAuthAddress) {
      publishAddress('auth', previousAuthAddress);
    } else {
      unpublishAddress('auth');
    }
    fakeAuth.closeAllConnections();
    await new Promise<void>((resolve) => fakeAuth.close(() => resolve()));
  });

  beforeEach(() => {
    received = [];
    accounts = [];
    reply = answerFromAccounts;
    publishAddress('auth', fakeAuthUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Drop any request a test left hanging
    fakeAuth.closeAllConnections();
  });

  async function createProject(userId: string) {
    const res = await request(server)
      .post('/projects')
      .set(auth(userId))
      .send({ name: 'Homelab', meshProvider: 'Tailscale' });
    return res.body as { id: string };
  }

  async function addMember(
    ownerId: string,
    projectId: string,
    joinerId: string,
  ) {
    const invite = await request(server)
      .post(`/projects/${projectId}/invites`)
      .set(auth(ownerId))
      .send({});
    const token = (invite.body.inviteLink as string).split('/').pop();
    const res = await request(server)
      .post(`/invites/${token}/accept`)
      .set(auth(joinerId));
    expect(res.status).toBe(200);
  }

  async function projectWithMember() {
    const owner = uid('owner');
    const member = uid('member');
    const { id } = await createProject(owner);
    await addMember(owner, id, member);
    return { owner, member, id };
  }

  const members = (userId: string, projectId: string) =>
    request(server).get(`/projects/${projectId}/members`).set(auth(userId));

  type Row = {
    userId: string;
    username: string | null;
    displayName: string | null;
  };
  const namesByUser = (body: Row[]) =>
    Object.fromEntries(
      body.map((m) => [m.userId, [m.username, m.displayName]]),
    );

  describe('GET /projects/:projectId/members', () => {
    it('shows the username and display name of every member', async () => {
      const { owner, member, id } = await projectWithMember();
      accounts = [cardFor(owner), cardFor(member)];

      const res = await members(member, id);

      expect(res.status).toBe(200);
      expect(namesByUser(res.body)).toEqual({
        [owner]: [`name-${owner}`, `Display ${owner}`],
        [member]: [`name-${member}`, `Display ${member}`],
      });
      expect(res.body.map((m: Row) => m.userId)).toEqual([owner, member]);
      expect(res.body.map((m: { isYou: boolean }) => m.isYou)).toEqual([
        false,
        true,
      ]);
    });

    it('sends the caller exact Authorization header and only this project members', async () => {
      const { owner, member, id } = await projectWithMember();
      // Another project with its own people must not leak into the lookup
      const stranger = uid('stranger');
      await createProject(stranger);
      accounts = [cardFor(owner), cardFor(member), cardFor(stranger)];
      const headers = auth(member);

      await request(server).get(`/projects/${id}/members`).set(headers);

      expect(received).toHaveLength(1);
      expect(received[0].method).toBe('POST');
      expect(received[0].url).toBe('/auth/users/lookup');
      expect(received[0].authorization).toBe(headers.Authorization);
      expect([...received[0].body.ids].sort()).toEqual([owner, member].sort());
    });

    it('names members for the web app, which signs in with a cookie instead of a header', async () => {
      const { owner, member, id } = await projectWithMember();
      accounts = [cardFor(owner), cardFor(member)];
      const token = auth(member).Authorization.replace('Bearer ', '');

      const res = await request(server)
        .get(`/projects/${id}/members`)
        .set('Cookie', `access_token=${token}`);

      expect(res.status).toBe(200);
      expect(namesByUser(res.body)).toEqual({
        [owner]: [`name-${owner}`, `Display ${owner}`],
        [member]: [`name-${member}`, `Display ${member}`],
      });
      expect(received).toHaveLength(1);
      expect(received[0].authorization).toBe(`Bearer ${token}`);
    });

    it('does not look anyone up for a caller who is not a member', async () => {
      const { id } = await projectWithMember();

      const res = await members(uid('outsider'), id);

      expect(res.status).toBe(404);
      expect(received).toHaveLength(0);
    });

    it('does not look anyone up without a token', async () => {
      const { id } = await projectWithMember();

      const res = await request(server).get(`/projects/${id}/members`);

      expect(res.status).toBe(401);
      expect(received).toHaveLength(0);
    });

    it('gives null names to a member whose account auth does not return', async () => {
      const { owner, member, id } = await projectWithMember();
      accounts = [cardFor(owner)];

      const res = await members(owner, id);

      expect(res.status).toBe(200);
      expect(namesByUser(res.body)).toEqual({
        [owner]: [`name-${owner}`, `Display ${owner}`],
        [member]: [null, null],
      });
    });

    it('does not look up a removed member', async () => {
      const { owner, member, id } = await projectWithMember();
      accounts = [cardFor(owner), cardFor(member)];
      const removed = await request(server)
        .delete(`/projects/${id}/members/${member}`)
        .set(auth(owner));
      expect(removed.status).toBe(204);
      received = [];

      const res = await members(owner, id);

      expect(res.status).toBe(200);
      expect(res.body.map((m: Row) => m.userId)).toEqual([owner]);
      expect(received).toHaveLength(1);
      expect(received[0].body.ids).toEqual([owner]);
    });

    describe('when auth cannot answer', () => {
      const expectListedWithoutNames = async (
        owner: string,
        member: string,
        id: string,
      ) => {
        const res = await members(owner, id);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(namesByUser(res.body)).toEqual({
          [owner]: [null, null],
          [member]: [null, null],
        });
        expect(res.body.map((m: Row) => m.userId)).toEqual([owner, member]);
      };

      it('lists members with null names when auth answers 500', async () => {
        const { owner, member, id } = await projectWithMember();
        reply = (_req, res) => {
          res.statusCode = 500;
          res.end('boom');
        };

        await expectListedWithoutNames(owner, member, id);
        expect(received).toHaveLength(1);
      });

      it('lists members with null names when auth answers 401', async () => {
        const { owner, member, id } = await projectWithMember();
        reply = (_req, res) => {
          res.statusCode = 401;
          res.end();
        };

        await expectListedWithoutNames(owner, member, id);
      });

      it('lists members with null names when auth answers invalid JSON', async () => {
        const { owner, member, id } = await projectWithMember();
        reply = (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end('{not json');
        };

        await expectListedWithoutNames(owner, member, id);
      });

      it('lists members with null names when auth answers JSON that is not a list', async () => {
        const { owner, member, id } = await projectWithMember();
        reply = (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message: 'nope' }));
        };

        await expectListedWithoutNames(owner, member, id);
      });

      it('lists members with null names when auth hangs past the timeout', async () => {
        const { owner, member, id } = await projectWithMember();
        // The real timeout is 5 seconds; shorten it so the test does not wait that long
        const realTimeout = AbortSignal.timeout.bind(AbortSignal);
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
          realTimeout(150),
        );
        reply = () => {
          // never answers
        };

        await expectListedWithoutNames(owner, member, id);
        expect(received).toHaveLength(1);
      });

      it('lists members with null names when auth refuses the connection', async () => {
        const { owner, member, id } = await projectWithMember();
        // A closed port: bind one, note it, release it
        const probe = createServer();
        await new Promise<void>((resolve) =>
          probe.listen(0, '127.0.0.1', resolve),
        );
        const { port } = probe.address() as AddressInfo;
        await new Promise<void>((resolve) => probe.close(() => resolve()));
        publishAddress('auth', `http://127.0.0.1:${port}`);

        await expectListedWithoutNames(owner, member, id);
      });

      it('lists members with null names when the auth address is not published', async () => {
        const { owner, member, id } = await projectWithMember();
        unpublishAddress('auth');

        await expectListedWithoutNames(owner, member, id);
        expect(received).toHaveLength(0);
      });
    });
  });

  describe('PATCH /projects/:projectId/members/:userId', () => {
    it('keeps userId and role in the response and leaves the names null', async () => {
      const { owner, member, id } = await projectWithMember();
      accounts = [cardFor(owner), cardFor(member)];

      const res = await request(server)
        .patch(`/projects/${id}/members/${member}`)
        .set(auth(owner))
        .send({ role: 'owner' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        userId: member,
        role: 'owner',
        username: null,
        displayName: null,
        isYou: false,
      });
      expect(received).toHaveLength(0);
    });
  });

  describe('GET /projects/:projectId/activity', () => {
    it('does not carry any member names', async () => {
      const { owner, member, id } = await projectWithMember();
      accounts = [cardFor(owner), cardFor(member)];
      // Listing members first proves the names were fetched and available
      const listed = await members(owner, id);
      expect(listed.body[0].username).toBe(`name-${owner}`);

      const res = await request(server)
        .get(`/projects/${id}/activity`)
        .set(auth(owner));

      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(`name-${owner}`);
      expect(text).not.toContain(`name-${member}`);
      expect(text).not.toContain('Display ');
      expect(text).not.toContain('displayName');
      expect(text).not.toContain('username');
    });
  });
});
