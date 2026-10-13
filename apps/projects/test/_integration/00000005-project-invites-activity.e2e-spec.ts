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
import { AuditLog } from '@libs/governance';

// import applications
import { ProjectsModule } from '@apps/projects';
import { AuthSessionService } from '../../src/identity/index.js';

// import features
import { ProjectInvite } from '../../src/project/index.js';

const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';
const INVALID_MESSAGE = 'Invite link is invalid or has expired';

/**
 * Covers invite management (create with a role, list, revoke, preview, accept) and the two
 * audit views of a project: the member-facing activity feed and the owner-only verification.
 */
describe('Project invites and activity (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;
  let jwt: JwtService;
  let counter = 0;

  // Every test works with its own people, so tests never see each other's projects
  const uid = (prefix = 'u'): string => `${prefix}-${++counter}`;
  const auth = (userId: string) => ({
    Authorization: `Bearer ${jwt.sign({ sub: userId })}`,
  });
  const tokenOf = (inviteLink: string): string =>
    inviteLink.split('/').pop() as string;

  beforeAll(async () => {
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

  const createInvite = (userId: string, projectId: string, body: object = {}) =>
    request(server)
      .post(`/projects/${projectId}/invites`)
      .set(auth(userId))
      .send(body);

  const listInvites = (userId: string, projectId: string) =>
    request(server).get(`/projects/${projectId}/invites`).set(auth(userId));

  const preview = (userId: string, token: string) =>
    request(server).get(`/invites/${token}`).set(auth(userId));

  const accept = (userId: string, token: string) =>
    request(server).post(`/invites/${token}/accept`).set(auth(userId));

  async function tokenFor(
    ownerId: string,
    projectId: string,
    body: object = {},
  ) {
    const res = await createInvite(ownerId, projectId, body);
    return tokenOf(res.body.inviteLink);
  }

  async function projectWithMember() {
    const owner = uid('owner');
    const member = uid('member');
    const { id } = await createProject(owner);
    expect((await accept(member, await tokenFor(owner, id))).status).toBe(200);
    return { owner, member, id };
  }

  const auditRows = (projectId: string) =>
    dataSource.getRepository(AuditLog).find({
      where: { scope: `project:${projectId}` },
      order: { sequence: 'ASC' },
    });

  describe('authentication', () => {
    const calls: [string, string][] = [
      ['post', `/projects/${UNKNOWN_UUID}/invites`],
      ['get', `/projects/${UNKNOWN_UUID}/invites`],
      ['delete', `/projects/${UNKNOWN_UUID}/invites/${UNKNOWN_UUID}`],
      ['get', `/invites/${'a'.repeat(64)}`],
      ['post', `/invites/${'a'.repeat(64)}/accept`],
      ['get', `/projects/${UNKNOWN_UUID}/activity`],
      ['get', `/projects/${UNKNOWN_UUID}/audit-logs/verify`],
    ];

    it.each(calls)(
      'rejects %s %s without a token with 401',
      async (verb, url) => {
        const res = await (
          request(server) as never as Record<
            string,
            (u: string) => request.Test
          >
        )[verb](url);
        expect(res.status).toBe(401);
      },
    );
  });

  describe('POST /projects/:projectId/invites', () => {
    it('creates a member invite that expires in 24 hours by default', async () => {
      const owner = uid();
      const { id } = await createProject(owner);

      const before = Date.now();
      const res = await createInvite(owner, id);

      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual([
        'expiresAt',
        'id',
        'inviteLink',
        'role',
      ]);
      expect(res.body.role).toBe('member');
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.inviteLink).toMatch(
        /^http:\/\/localhost:3000\/invite\/[0-9a-f]{64}$/,
      );
      const lifetime = new Date(res.body.expiresAt).getTime() - before;
      expect(Math.abs(lifetime - 24 * 60 * 60 * 1000)).toBeLessThan(5000);
    });

    it('creates an owner invite and honours the lifetime', async () => {
      const owner = uid();
      const { id } = await createProject(owner);

      const before = Date.now();
      const res = await createInvite(owner, id, {
        role: 'owner',
        expiresInMinutes: 30,
      });

      expect(res.status).toBe(201);
      expect(res.body.role).toBe('owner');
      const lifetime = new Date(res.body.expiresAt).getTime() - before;
      expect(Math.abs(lifetime - 30 * 60 * 1000)).toBeLessThan(5000);
    });

    it('makes every link different and never stores the raw token', async () => {
      const owner = uid();
      const { id } = await createProject(owner);

      const a = await createInvite(owner, id);
      const b = await createInvite(owner, id);

      expect(a.body.inviteLink).not.toBe(b.body.inviteLink);
      const stored = await dataSource
        .getRepository(ProjectInvite)
        .findOneByOrFail({ id: a.body.id });
      expect(stored.tokenHash).not.toContain(tokenOf(a.body.inviteLink));
      expect(stored.createdByUserId).toBe(owner);
    });

    it.each([1, 10080])('accepts a lifetime of %i minutes', async (minutes) => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await createInvite(owner, id, { expiresInMinutes: minutes });
      expect(res.status).toBe(201);
    });

    it.each([
      ['a zero lifetime', { expiresInMinutes: 0 }],
      ['a negative lifetime', { expiresInMinutes: -5 }],
      ['a lifetime over a week', { expiresInMinutes: 10081 }],
      ['a fractional lifetime', { expiresInMinutes: 1.5 }],
      ['a text lifetime', { expiresInMinutes: 'soon' }],
      ['a null lifetime', { expiresInMinutes: null }],
      ['an unknown role', { role: 'admin' }],
      ['an upper-case role', { role: 'OWNER' }],
      ['a null role', { role: null }],
      ['a numeric role', { role: 1 }],
    ])('rejects %s with 400', async (_label, body) => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await createInvite(owner, id, body);
      expect(res.status).toBe(400);
    });

    it('ignores unknown fields instead of storing them', async () => {
      const owner = uid();
      const { id } = await createProject(owner);

      const res = await createInvite(owner, id, {
        createdByUserId: 'forged',
        projectId: UNKNOWN_UUID,
        tokenHash: 'x',
      });

      expect(res.status).toBe(201);
      const stored = await dataSource
        .getRepository(ProjectInvite)
        .findOneByOrFail({ id: res.body.id });
      expect(stored).toMatchObject({ createdByUserId: owner, projectId: id });
    });

    it('refuses a plain member with 403 and an outsider with 404', async () => {
      const { member, id } = await projectWithMember();
      const asMember = await createInvite(member, id);
      const asOutsider = await createInvite(uid('outsider'), id);
      expect(asMember.status).toBe(403);
      expect(asOutsider.status).toBe(404);
    });

    it('rejects a malformed project id with 400', async () => {
      const res = await createInvite(uid(), 'nope');
      expect(res.status).toBe(400);
    });

    it('records a denied project.invite.create for a member', async () => {
      const { member, id } = await projectWithMember();
      await createInvite(member, id);

      const denied = (await auditRows(id)).find(
        (r) => r.action === 'project.invite.create' && r.outcome === 'denied',
      );

      expect(denied).toMatchObject({ actorId: member, entityId: id });
    });
  });

  describe('GET /projects/:projectId/invites', () => {
    it('returns an empty list when there are no invites', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await listInvites(owner, id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('lists open invites newest first, without any secret', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const older = await createInvite(owner, id, { role: 'owner' });
      const newer = await createInvite(owner, id);
      const base = Date.parse('2024-01-01T00:00:00Z');
      await dataSource
        .getRepository(ProjectInvite)
        .update({ id: older.body.id }, { createdAt: new Date(base) });
      await dataSource
        .getRepository(ProjectInvite)
        .update({ id: newer.body.id }, { createdAt: new Date(base + 60_000) });

      const res = await listInvites(owner, id);

      expect(res.status).toBe(200);
      expect(res.body.map((i: { id: string }) => i.id)).toEqual([
        newer.body.id,
        older.body.id,
      ]);
      expect(res.body[0]).toMatchObject({
        id: newer.body.id,
        role: 'member',
        createdByUserId: owner,
        expiresAt: newer.body.expiresAt,
      });
      expect(Object.keys(res.body[0]).sort()).toEqual([
        'createdAt',
        'createdByUserId',
        'expiresAt',
        'id',
        'role',
      ]);
      expect(res.body[1].role).toBe('owner');
      expect(JSON.stringify(res.body)).not.toContain(
        tokenOf(newer.body.inviteLink),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|inviteLink/);
    });

    it('leaves out used, revoked and expired invites', async () => {
      const { owner, id } = await projectWithMember();
      const open = await createInvite(owner, id);
      const revoked = await createInvite(owner, id);
      const expired = await createInvite(owner, id);
      await request(server)
        .delete(`/projects/${id}/invites/${revoked.body.id}`)
        .set(auth(owner));
      await dataSource
        .getRepository(ProjectInvite)
        .update(
          { id: expired.body.id },
          { expiresAt: new Date(Date.now() - 1000) },
        );

      const res = await listInvites(owner, id);

      expect(res.body.map((i: { id: string }) => i.id)).toEqual([open.body.id]);
    });

    it('does not show the invites of another project', async () => {
      const owner = uid();
      const a = await createProject(owner, 'A');
      const b = await createProject(owner, 'B');
      await createInvite(owner, a.id);

      expect((await listInvites(owner, b.id)).body).toEqual([]);
    });

    it('refuses a plain member with 403 and an outsider with 404', async () => {
      const { member, id } = await projectWithMember();
      expect((await listInvites(member, id)).status).toBe(403);
      expect((await listInvites(uid('outsider'), id)).status).toBe(404);
    });

    it('rejects a malformed project id with 400', async () => {
      expect((await listInvites(uid(), 'nope')).status).toBe(400);
    });

    it('records a denied project.invite.list for a member', async () => {
      const { member, id } = await projectWithMember();
      await listInvites(member, id);
      const rows = await auditRows(id);
      expect(
        rows.some(
          (r) => r.action === 'project.invite.list' && r.outcome === 'denied',
        ),
      ).toBe(true);
    });
  });

  describe('DELETE /projects/:projectId/invites/:inviteId', () => {
    const revoke = (userId: string, projectId: string, inviteId: string) =>
      request(server)
        .delete(`/projects/${projectId}/invites/${inviteId}`)
        .set(auth(userId));

    it('revokes the invite, which then no longer works', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const invite = await createInvite(owner, id);
      const token = tokenOf(invite.body.inviteLink);

      const res = await revoke(owner, id, invite.body.id);

      expect(res.status).toBe(204);
      expect((await listInvites(owner, id)).body).toEqual([]);
      const joiner = uid('joiner');
      const previewed = await preview(joiner, token);
      const accepted = await accept(joiner, token);
      expect(previewed.status).toBe(400);
      expect(accepted.status).toBe(400);
      expect(accepted.body.message).toBe(INVALID_MESSAGE);
    });

    it('only revokes the named invite', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const keep = await createInvite(owner, id);
      const drop = await createInvite(owner, id);

      await revoke(owner, id, drop.body.id);

      expect(
        (await accept(uid('joiner'), tokenOf(keep.body.inviteLink))).status,
      ).toBe(200);
    });

    it('returns 404 for an unknown invite and for one revoked twice', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const invite = await createInvite(owner, id);
      await revoke(owner, id, invite.body.id);

      expect((await revoke(owner, id, UNKNOWN_UUID)).status).toBe(404);
      expect((await revoke(owner, id, invite.body.id)).status).toBe(404);
    });

    it('returns 404 for an invite already used', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const invite = await createInvite(owner, id);
      await accept(uid('joiner'), tokenOf(invite.body.inviteLink));
      expect((await revoke(owner, id, invite.body.id)).status).toBe(404);
    });

    it('cannot reach an invite of another project, even as owner of both', async () => {
      const owner = uid();
      const a = await createProject(owner, 'A');
      const b = await createProject(owner, 'B');
      const invite = await createInvite(owner, a.id);

      const res = await revoke(owner, b.id, invite.body.id);

      expect(res.status).toBe(404);
      expect((await listInvites(owner, a.id)).body).toHaveLength(1);
    });

    it('cannot be used by the owner of a different project', async () => {
      const owner = uid();
      const stranger = uid('stranger');
      const { id } = await createProject(owner);
      await createProject(stranger);
      const invite = await createInvite(owner, id);

      const res = await revoke(stranger, id, invite.body.id);

      expect(res.status).toBe(404);
      expect((await listInvites(owner, id)).body).toHaveLength(1);
    });

    it('refuses a plain member with 403 and keeps the invite', async () => {
      const { owner, member, id } = await projectWithMember();
      const invite = await createInvite(owner, id);
      const res = await revoke(member, id, invite.body.id);
      expect(res.status).toBe(403);
      expect((await listInvites(owner, id)).body).toHaveLength(1);
    });

    it('rejects malformed ids with 400', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      expect((await revoke(owner, 'nope', UNKNOWN_UUID)).status).toBe(400);
      expect((await revoke(owner, id, 'nope')).status).toBe(400);
    });

    it('still works while the project is archived', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const invite = await createInvite(owner, id);
      await request(server).post(`/projects/${id}/archive`).set(auth(owner));
      expect((await revoke(owner, id, invite.body.id)).status).toBe(204);
    });

    it('records project_invite.deleted and a denied revoke', async () => {
      const { owner, member, id } = await projectWithMember();
      const invite = await createInvite(owner, id);
      await revoke(member, id, invite.body.id);
      await revoke(owner, id, invite.body.id);

      const rows = await auditRows(id);

      const deleted = rows.filter(
        (r) =>
          r.action === 'project_invite.deleted' &&
          r.entityId === invite.body.id,
      );
      expect(deleted).toHaveLength(1);
      expect(deleted[0].actorId).toBe(owner);
      expect(deleted[0].changes).not.toContain(tokenOf(invite.body.inviteLink));
      expect(
        rows.some(
          (r) => r.action === 'project.invite.revoke' && r.outcome === 'denied',
        ),
      ).toBe(true);
    });
  });

  describe('GET /invites/:token', () => {
    it('shows what the link leads to without joining', async () => {
      const { owner, id } = await projectWithMember();
      const invite = await createInvite(owner, id, { role: 'owner' });
      const joiner = uid('joiner');

      const res = await preview(joiner, tokenOf(invite.body.inviteLink));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        projectName: 'Homelab',
        meshProvider: 'Tailscale',
        memberCount: 2,
        role: 'owner',
        expiresAt: invite.body.expiresAt,
        alreadyMember: false,
      });
      const mine = await request(server).get('/projects').set(auth(joiner));
      expect(mine.body.items).toEqual([]);
    });

    it('does not use the invite up', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const token = await tokenFor(owner, id);

      await preview(uid('a'), token);
      await preview(uid('b'), token);

      expect((await accept(uid('joiner'), token)).status).toBe(200);
    });

    it('tells a member that they are already in', async () => {
      const { owner, member, id } = await projectWithMember();
      const token = await tokenFor(owner, id);
      expect((await preview(member, token)).body.alreadyMember).toBe(true);
      expect((await preview(owner, token)).body.alreadyMember).toBe(true);
    });

    it('does not reveal the project id', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await preview(uid(), await tokenFor(owner, id));
      expect(JSON.stringify(res.body)).not.toContain(id);
    });

    it.each([
      ['too short', 'abc123'],
      ['not hex', 'z'.repeat(64)],
      ['upper-case hex', 'A'.repeat(64)],
      ['63 characters', 'a'.repeat(63)],
      ['65 characters', 'a'.repeat(65)],
      ['word-like', 'not-a-real-token'],
    ])(
      'rejects a token that is %s with 400 before the database',
      async (_l, token) => {
        const res = await preview(uid(), token);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe(INVALID_MESSAGE);
      },
    );

    it('rejects a well-formed token nobody issued with 400', async () => {
      const res = await preview(uid(), 'a'.repeat(64));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(INVALID_MESSAGE);
    });

    it('rejects an expired invite with the same answer as an unknown one', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const invite = await createInvite(owner, id);
      await dataSource
        .getRepository(ProjectInvite)
        .update(
          { id: invite.body.id },
          { expiresAt: new Date(Date.now() - 1000) },
        );

      const res = await preview(uid(), tokenOf(invite.body.inviteLink));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(INVALID_MESSAGE);
    });

    it('rejects a used invite with 400', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const token = await tokenFor(owner, id);
      await accept(uid('joiner'), token);
      expect((await preview(uid(), token)).status).toBe(400);
    });

    it('rejects the invite of an archived project, and works again after unarchiving', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const token = await tokenFor(owner, id);
      await request(server).post(`/projects/${id}/archive`).set(auth(owner));

      const closed = await preview(uid(), token);
      await request(server).post(`/projects/${id}/unarchive`).set(auth(owner));
      const open = await preview(uid(), token);

      expect(closed.status).toBe(400);
      expect(closed.body.message).toBe(INVALID_MESSAGE);
      expect(open.status).toBe(200);
    });

    it('counts only current members', async () => {
      const { owner, member, id } = await projectWithMember();
      await request(server)
        .delete(`/projects/${id}/members/${member}`)
        .set(auth(owner));
      const res = await preview(uid(), await tokenFor(owner, id));
      expect(res.body.memberCount).toBe(1);
    });
  });

  describe('POST /invites/:token/accept', () => {
    it('grants the member role of a default invite', async () => {
      const owner = uid();
      const joiner = uid('joiner');
      const { id } = await createProject(owner);

      const res = await accept(joiner, await tokenFor(owner, id));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        role: 'member',
        memberCount: 2,
        archivedAt: null,
      });
    });

    it('grants the owner role of an owner invite, with owner powers', async () => {
      const owner = uid();
      const joiner = uid('joiner');
      const { id } = await createProject(owner);

      const res = await accept(
        joiner,
        await tokenFor(owner, id, { role: 'owner' }),
      );

      expect(res.body.role).toBe('owner');
      const rename = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(joiner))
        .send({ name: 'By invitee' });
      expect(rename.status).toBe(200);
    });

    it('does not let a member promote themselves with the role of another invite', async () => {
      const { member, owner, id } = await projectWithMember();
      const ownerInvite = await tokenFor(owner, id, { role: 'owner' });

      const res = await accept(member, ownerInvite);

      expect(res.status).toBe(409);
      const me = await request(server).get(`/projects/${id}`).set(auth(member));
      expect(me.body.role).toBe('member');
    });

    it('returns 409 for a member trying again and keeps the invite open', async () => {
      const { owner, member, id } = await projectWithMember();
      const token = await tokenFor(owner, id);
      const res = await accept(member, token);
      expect(res.status).toBe(409);
      expect((await listInvites(owner, id)).body).toHaveLength(1);
    });

    it('returns 409 for an archived project and keeps the invite', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const token = await tokenFor(owner, id);
      await request(server).post(`/projects/${id}/archive`).set(auth(owner));

      const res = await accept(uid('joiner'), token);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Project is archived');
      await request(server).post(`/projects/${id}/unarchive`).set(auth(owner));
      expect((await accept(uid('joiner'), token)).status).toBe(200);
    });

    it('rejects a revoked invite with 400', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const invite = await createInvite(owner, id);
      await request(server)
        .delete(`/projects/${id}/invites/${invite.body.id}`)
        .set(auth(owner));
      const res = await accept(uid('joiner'), tokenOf(invite.body.inviteLink));
      expect(res.status).toBe(400);
    });

    it('records a failure entry for a refused acceptance', async () => {
      const owner = uid();
      const joiner = uid('joiner');
      const { id } = await createProject(owner);
      const token = await tokenFor(owner, id);
      await request(server).post(`/projects/${id}/archive`).set(auth(owner));
      await accept(joiner, token);

      const failure = (await auditRows(id)).find(
        (r) => r.action === 'project.invite.accept',
      );

      expect(failure).toMatchObject({ outcome: 'failure', actorId: joiner });
      expect(JSON.parse(failure!.metadata)).toMatchObject({
        reason: 'Project is archived',
      });
    });
  });

  describe('GET /projects/:projectId/activity', () => {
    const activity = (userId: string, projectId: string, query = '') =>
      request(server)
        .get(`/projects/${projectId}/activity${query}`)
        .set(auth(userId));

    it('shows a member what happened, newest first, with trimmed entries', async () => {
      const { owner, member, id } = await projectWithMember();
      await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'Renamed' });

      const res = await activity(member, id);

      expect(res.status).toBe(200);
      expect(res.body.nextBefore).toBeNull();
      const items = res.body.items as {
        sequence: number;
        action: string;
        actorId: string;
      }[];
      const sequences = items.map((i) => i.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => b - a));
      expect(items[0]).toMatchObject({
        action: 'project.updated',
        actorId: owner,
      });
      expect(items.map((i) => i.action)).toEqual(
        expect.arrayContaining([
          'project.created',
          'project_member.created',
          'project_invite.created',
          'project_invite.deleted',
        ]),
      );
      for (const item of res.body.items) {
        expect(Object.keys(item).sort()).toEqual([
          'action',
          'actorId',
          'entityId',
          'entityType',
          'occurredAt',
          'sequence',
        ]);
        expect(new Date(item.occurredAt).getTime()).not.toBeNaN();
      }
    });

    it('is open to owners too', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await activity(owner, id);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('leaks neither details, addresses, agents nor secrets', async () => {
      const owner = uid();
      const member = uid('member');
      const { id } = await createProject(owner);
      const invite = await createInvite(owner, id, { role: 'owner' });
      const token = tokenOf(invite.body.inviteLink);
      await accept(member, token);
      await request(server)
        .patch(`/projects/${id}`)
        .set({ ...auth(owner), 'user-agent': 'secret-agent/9.9' })
        .send({ name: 'Very private new name' });

      const res = await activity(member, id);
      const text = JSON.stringify(res.body);

      expect(text).not.toContain('Very private new name');
      expect(text).not.toContain('Homelab');
      expect(text).not.toContain('secret-agent');
      expect(text).not.toContain('127.0.0.1');
      expect(text).not.toContain(token);
      expect(text).not.toMatch(
        /"(changes|metadata|ip|peerIp|userAgent|forwardedFor|requestId|hash|previousHash|outcome|scope|eventId|tokenHash|before|after)"/,
      );
    });

    it('leaves out refused attempts', async () => {
      const { owner, member, id } = await projectWithMember();
      await request(server)
        .patch(`/projects/${id}`)
        .set(auth(member))
        .send({ name: 'nope' });
      await request(server).post(`/projects/${id}/archive`).set(auth(member));
      await accept(owner, 'a'.repeat(64));

      const feed = await activity(owner, id);
      const trail = await auditRows(id);

      expect(trail.some((r) => r.outcome === 'denied')).toBe(true);
      const actions = feed.body.items.map((i: { action: string }) => i.action);
      expect(actions).not.toContain('project.update');
      expect(actions).not.toContain('project.archive');
      expect(actions).not.toContain('project.invite.accept');
      expect(feed.body.items.length).toBe(
        trail.filter((r) => r.outcome === 'success').length,
      );
    });

    it('only shows the events of its own project', async () => {
      const owner = uid();
      const a = await createProject(owner, 'A');
      const b = await createProject(owner, 'B');
      await createInvite(owner, b.id);
      await createInvite(owner, b.id);

      const res = await activity(owner, a.id);

      const entityIds = res.body.items.map(
        (i: { entityId: string }) => i.entityId,
      );
      const trail = (await auditRows(a.id)).map((r) => r.entityId);
      expect(entityIds.sort()).toEqual(trail.sort());
    });

    it('pages with limit and before', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      for (let i = 0; i < 3; i++) await createInvite(owner, id);
      const all = (await activity(owner, id)).body.items as {
        sequence: number;
      }[];
      expect(all.length).toBeGreaterThanOrEqual(5);

      const first = await activity(owner, id, '?limit=2');
      expect(
        first.body.items.map((i: { sequence: number }) => i.sequence),
      ).toEqual(all.slice(0, 2).map((i) => i.sequence));
      expect(first.body.nextBefore).toBe(all[1].sequence);

      const second = await activity(
        owner,
        id,
        `?limit=2&before=${first.body.nextBefore}`,
      );
      expect(
        second.body.items.map((i: { sequence: number }) => i.sequence),
      ).toEqual(all.slice(2, 4).map((i) => i.sequence));

      const last = await activity(owner, id, `?limit=${all.length}`);
      expect(last.body.nextBefore).toBeNull();
    });

    it('may return a short page when refused attempts fill it', async () => {
      const { member, id } = await projectWithMember();
      await request(server)
        .patch(`/projects/${id}`)
        .set(auth(member))
        .send({ name: 'nope' });

      const res = await activity(member, id, '?limit=1');

      expect(res.body.items).toEqual([]);
      expect(res.body.nextBefore).toBeTypeOf('number');
    });

    it('records nothing for reading the feed', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const before = (await auditRows(id)).length;
      await activity(owner, id);
      expect((await auditRows(id)).length).toBe(before);
    });

    it('returns 404 to an outsider, also after being removed', async () => {
      const { owner, member, id } = await projectWithMember();
      expect((await activity(uid('outsider'), id)).status).toBe(404);
      await request(server)
        .delete(`/projects/${id}/members/${member}`)
        .set(auth(owner));
      expect((await activity(member, id)).status).toBe(404);
    });

    it.each(['limit=0', 'limit=201', 'limit=abc', 'before=0', 'before=abc'])(
      'rejects %s with 400',
      async (query) => {
        const owner = uid();
        const { id } = await createProject(owner);
        expect((await activity(owner, id, `?${query}`)).status).toBe(400);
      },
    );

    it('rejects a malformed project id with 400', async () => {
      expect((await activity(uid(), 'nope')).status).toBe(400);
    });
  });

  describe('GET /projects/:projectId/audit-logs', () => {
    it('stays closed to plain members and outsiders', async () => {
      const { owner, member, id } = await projectWithMember();
      const asMember = await request(server)
        .get(`/projects/${id}/audit-logs`)
        .set(auth(member));
      const asOutsider = await request(server)
        .get(`/projects/${id}/audit-logs`)
        .set(auth(uid('outsider')));
      const asOwner = await request(server)
        .get(`/projects/${id}/audit-logs`)
        .set(auth(owner));
      expect(asMember.status).toBe(403);
      expect(asOutsider.status).toBe(404);
      expect(asOwner.status).toBe(200);
    });
  });

  describe('GET /projects/:projectId/audit-logs/verify', () => {
    const verify = (userId: string, projectId: string) =>
      request(server)
        .get(`/projects/${projectId}/audit-logs/verify`)
        .set(auth(userId));

    it('tells an owner that the chain is intact, and nothing else', async () => {
      const owner = uid();
      const { id } = await createProject(owner);

      const res = await verify(owner, id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: true });
    });

    it('refuses a plain member with 403 and records the attempt', async () => {
      const { member, id } = await projectWithMember();

      const res = await verify(member, id);

      expect(res.status).toBe(403);
      expect(
        (await auditRows(id)).some(
          (r) =>
            r.action === 'project.audit.verify' &&
            r.outcome === 'denied' &&
            r.actorId === member,
        ),
      ).toBe(true);
    });

    it('returns 404 to an outsider and 400 for a malformed id', async () => {
      const { id } = await createProject(uid());
      expect((await verify(uid('outsider'), id)).status).toBe(404);
      expect((await verify(uid(), 'nope')).status).toBe(400);
    });

    it('is not mistaken for an audit-logs page and needs no parameters', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await request(server)
        .get(`/projects/${id}/audit-logs/verify?limit=0`)
        .set(auth(owner));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: true });
    });

    // Last on purpose: it breaks the chain of this file's database for good
    it('reports an invalid chain after tampering, without saying where', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      await dataSource.query('DROP TRIGGER governance_update_audit_logs');
      await dataSource.query(
        "UPDATE audit_logs SET action = 'forged' WHERE sequence = 2",
      );

      const res = await verify(owner, id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false });
    });
  });
});
