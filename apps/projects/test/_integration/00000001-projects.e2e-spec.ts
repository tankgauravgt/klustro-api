import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { Server } from 'node:http';

// import application libraries
import { AppConfigService } from '@libs/common';

// import applications
import { ProjectsModule } from '@apps/projects';
import { AuthSessionService } from '../../src/identity/index.js';

// import features
import { Project } from '../../src/project/index.js';
import { ProjectInvite } from '../../src/project/index.js';

// import models

/**
 * Covers the projects service: creating, listing and leaving projects,
 * owner/member roles, and expiring single-use invite links. Tokens are signed
 * locally with the shared secret, so no auth service is needed.
 */
describe('Projects (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;
  let jwt: JwtService;

  const tokenFor = (userId: string): string => jwt.sign({ sub: userId });
  const auth = (userId: string) => ({
    Authorization: `Bearer ${tokenFor(userId)}`,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProjectsModule],
    })
      .overrideProvider(AuthSessionService)
      .useValue({
        // Stands in for the auth service: the token's subject is the user
        verify: async (token: string) => ({ id: jwt.decode(token).sub }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0);
    server = app.getHttpServer();
    dataSource = moduleRef.get(DataSource);
    jwt = new JwtService({
      secret: moduleRef.get(AppConfigService).get('JWT_SECRET'),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProject(userId: string, name = 'Homelab') {
    const res = await request(server)
      .post('/projects')
      .set(auth(userId))
      .send({ name, meshProvider: 'Tailscale' });
    return res.body as { id: string };
  }

  async function createInvite(
    userId: string,
    projectId: string,
    body: object = {},
  ) {
    return request(server)
      .post(`/projects/${projectId}/invites`)
      .set(auth(userId))
      .send(body);
  }

  const tokenOf = (inviteLink: string): string =>
    inviteLink.split('/').pop() as string;

  describe('authentication', () => {
    it('rejects requests without a token with 401', async () => {
      const res = await request(server).get('/projects');
      expect(res.status).toBe(401);
    });

    it('rejects a token signed with the right secret but another algorithm with 401', async () => {
      const secret = app.get(AppConfigService).get('JWT_SECRET');
      const forged = new JwtService({ secret }).sign(
        { sub: 'someone' },
        { algorithm: 'HS384' },
      );

      const res = await request(server)
        .get('/projects')
        .set('Authorization', `Bearer ${forged}`);

      expect(res.status).toBe(401);
    });

    it('rejects a token signed with another secret with 401', async () => {
      const forged = new JwtService({ secret: 'wrong' }).sign({ sub: 'u' });
      const res = await request(server)
        .get('/projects')
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /projects', () => {
    it('creates a project and makes the creator its owner', async () => {
      const res = await request(server)
        .post('/projects')
        .set(auth('creator'))
        .send({ name: '  Edge Fleet  ', meshProvider: 'Headscale' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Edge Fleet',
        meshProvider: 'Headscale',
        role: 'owner',
        memberCount: 1,
      });
      expect(res.body.id).toBeTypeOf('string');
    });

    it.each(['Tailscale', 'Cloudflare', 'Headscale'])(
      'accepts %s as the mesh provider',
      async (meshProvider) => {
        const res = await request(server)
          .post('/projects')
          .set(auth('creator'))
          .send({ name: 'p', meshProvider });
        expect(res.status).toBe(201);
      },
    );

    it('requires a mesh provider at creation', async () => {
      const res = await request(server)
        .post('/projects')
        .set(auth('creator'))
        .send({ name: 'No mesh' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown mesh provider', async () => {
      const res = await request(server)
        .post('/projects')
        .set(auth('creator'))
        .send({ name: 'Bad mesh', meshProvider: 'ZeroTier' });
      expect(res.status).toBe(400);
    });

    it('rejects a blank name', async () => {
      const res = await request(server)
        .post('/projects')
        .set(auth('creator'))
        .send({ name: '   ', meshProvider: 'Tailscale' });
      expect(res.status).toBe(400);
    });
  });

  describe('mesh provider immutability', () => {
    it('exposes no endpoint to change a project', async () => {
      const { id } = await createProject('immutable-user');
      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth('immutable-user'))
        .send({ meshProvider: 'Cloudflare' });
      expect(res.status).toBe(404);
    });

    it('ignores mesh provider changes at the persistence layer', async () => {
      const { id } = await createProject('immutable-user-2');
      const repository = dataSource.getRepository(Project);

      const project = await repository.findOneByOrFail({ id });
      project.meshProvider = 'Cloudflare';
      project.name = 'Renamed';
      await repository.save(project);

      const reloaded = await repository.findOneByOrFail({ id });
      expect(reloaded.name).toBe('Renamed');
      expect(reloaded.meshProvider).toBe('Tailscale');
    });
  });

  describe('GET /projects', () => {
    it('lists only the projects the user has joined', async () => {
      const mine = await createProject('lister', 'Mine');
      await createProject('someone-else', 'Not mine');

      const res = await request(server).get('/projects').set(auth('lister'));

      expect(res.status).toBe(200);
      expect(res.body.map((p: { id: string }) => p.id)).toEqual([mine.id]);
      expect(res.body[0]).toMatchObject({ role: 'owner', memberCount: 1 });
    });

    it('returns an empty list for a user with no projects', async () => {
      const res = await request(server).get('/projects').set(auth('nobody'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('invites', () => {
    it('lets an owner create an invite link that expires in 24h by default', async () => {
      const { id } = await createProject('inviter');
      const res = await createInvite('inviter', id);

      expect(res.status).toBe(201);
      expect(res.body.inviteLink).toContain('/invite/');
      const hours =
        (new Date(res.body.expiresAt).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThanOrEqual(24);
    });

    it('honours a custom expiry', async () => {
      const { id } = await createProject('inviter-custom');
      const res = await createInvite('inviter-custom', id, {
        expiresInMinutes: 30,
      });
      const minutes =
        (new Date(res.body.expiresAt).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(29.9);
      expect(minutes).toBeLessThanOrEqual(30);
    });

    it('rejects an out-of-range expiry', async () => {
      const { id } = await createProject('inviter-range');
      const res = await createInvite('inviter-range', id, {
        expiresInMinutes: 0,
      });
      expect(res.status).toBe(400);
    });

    it('rejects an explicit null expiry instead of expiring the link at once', async () => {
      const { id } = await createProject('inviter-null');
      const res = await createInvite('inviter-null', id, {
        expiresInMinutes: null,
      });
      expect(res.status).toBe(400);

      const invites = await dataSource.getRepository(ProjectInvite).count({
        where: { projectId: id },
      });
      expect(invites).toBe(0);
    });

    it('forbids members from creating invites', async () => {
      const { id } = await createProject('owner-a');
      const invite = await createInvite('owner-a', id);
      await request(server)
        .post(`/invites/${tokenOf(invite.body.inviteLink)}/accept`)
        .set(auth('member-a'));

      const res = await createInvite('member-a', id);
      expect(res.status).toBe(403);
    });

    it('hides projects from non-members with 404', async () => {
      const { id } = await createProject('owner-b');
      const res = await createInvite('stranger', id);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /invites/:token/accept', () => {
    it('joins the user as a member', async () => {
      const { id } = await createProject('owner-c');
      const invite = await createInvite('owner-c', id);

      const res = await request(server)
        .post(`/invites/${tokenOf(invite.body.inviteLink)}/accept`)
        .set(auth('joiner'));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, role: 'member', memberCount: 2 });

      const listed = await request(server).get('/projects').set(auth('joiner'));
      expect(listed.body.map((p: { id: string }) => p.id)).toContain(id);
    });

    it('consumes the invite so it cannot be used twice', async () => {
      const { id } = await createProject('owner-d');
      const token = tokenOf(
        (await createInvite('owner-d', id)).body.inviteLink,
      );

      const first = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth('first'));
      const second = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth('second'));

      expect(first.status).toBe(200);
      expect(second.status).toBe(400);
    });

    it('keeps the invite usable when an existing member tries it', async () => {
      const { id } = await createProject('owner-e');
      const token = tokenOf(
        (await createInvite('owner-e', id)).body.inviteLink,
      );

      const ownerTry = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth('owner-e'));
      const realJoin = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth('newcomer'));

      expect(ownerTry.status).toBe(409);
      expect(realJoin.status).toBe(200);
    });

    it('rejects an unknown token', async () => {
      const res = await request(server)
        .post('/invites/not-a-real-token/accept')
        .set(auth('anyone'));
      expect(res.status).toBe(400);
    });

    it('rejects an expired invite', async () => {
      const { id } = await createProject('owner-f');
      const token = tokenOf(
        (await createInvite('owner-f', id)).body.inviteLink,
      );
      await dataSource
        .getRepository(ProjectInvite)
        .update({ projectId: id }, { expiresAt: new Date(Date.now() - 1000) });

      const res = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth('late'));
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /projects/:projectId/membership', () => {
    it('removes the project from the leaving user only', async () => {
      const { id } = await createProject('owner-g');
      const token = tokenOf(
        (await createInvite('owner-g', id)).body.inviteLink,
      );
      await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth('leaver'));

      const res = await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('leaver'));
      expect(res.status).toBe(204);

      const leaverList = await request(server)
        .get('/projects')
        .set(auth('leaver'));
      const ownerList = await request(server)
        .get('/projects')
        .set(auth('owner-g'));
      expect(leaverList.body).toEqual([]);
      expect(ownerList.body[0]).toMatchObject({ id, memberCount: 1 });
    });

    it('deletes the project when the last member leaves', async () => {
      const { id } = await createProject('solo');
      const token = tokenOf((await createInvite('solo', id)).body.inviteLink);

      const res = await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('solo'));
      expect(res.status).toBe(204);

      expect(await dataSource.getRepository(Project).existsBy({ id })).toBe(
        false,
      );
      const accept = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth('too-late'));
      expect(accept.status).toBe(400);
    });

    it('promotes a member when the last owner leaves', async () => {
      const { id } = await createProject('owner-h');
      const token = tokenOf(
        (await createInvite('owner-h', id)).body.inviteLink,
      );
      await request(server).post(`/invites/${token}/accept`).set(auth('heir'));

      await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('owner-h'));

      const list = await request(server).get('/projects').set(auth('heir'));
      expect(list.body[0]).toMatchObject({ id, role: 'owner', memberCount: 1 });
    });

    it('returns 404 for a project the user has not joined', async () => {
      const { id } = await createProject('owner-i');
      const res = await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('outsider'));
      expect(res.status).toBe(404);
    });

    it('rejects a malformed project id with 400', async () => {
      const res = await request(server)
        .delete('/projects/not-a-uuid/membership')
        .set(auth('anyone'));
      expect(res.status).toBe(400);
    });
  });
});
