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
import { Project } from '../../src/project/index.js';
import { ProjectInvite } from '../../src/project/index.js';
import { ProjectMember } from '../../src/project/index.js';

const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * Covers project management: reading, listing (search, filters, sorting, paging), renaming,
 * archiving, deleting, members, roles and ownership transfer, including who may do what.
 */
describe('Project management (e2e)', () => {
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

  async function createProject(
    userId: string,
    name = 'Homelab',
    meshProvider = 'Tailscale',
  ) {
    const res = await request(server)
      .post('/projects')
      .set(auth(userId))
      .send({ name, meshProvider });
    return res.body as {
      id: string;
      name: string;
      createdAt: string;
      archivedAt: string | null;
    };
  }

  // Invites `joinerId` and accepts on their behalf
  async function addMember(
    ownerId: string,
    projectId: string,
    joinerId: string,
    role: 'member' | 'owner' = 'member',
  ) {
    const invite = await request(server)
      .post(`/projects/${projectId}/invites`)
      .set(auth(ownerId))
      .send({ role });
    const token = (invite.body.inviteLink as string).split('/').pop();
    const res = await request(server)
      .post(`/invites/${token}/accept`)
      .set(auth(joinerId));
    expect(res.status).toBe(200);
  }

  // A project owned by `owner` with one plain member
  async function projectWithMember() {
    const owner = uid('owner');
    const member = uid('member');
    const { id } = await createProject(owner);
    await addMember(owner, id, member);
    return { owner, member, id };
  }

  const archive = (userId: string, id: string) =>
    request(server).post(`/projects/${id}/archive`).set(auth(userId));

  const listOf = (userId: string, query = '') =>
    request(server).get(`/projects${query}`).set(auth(userId));

  const namesOf = (res: request.Response): string[] =>
    (res.body.items as { name: string }[]).map((item) => item.name);

  const auditRows = (projectId: string) =>
    dataSource.getRepository(AuditLog).find({
      where: { scope: `project:${projectId}` },
      order: { sequence: 'ASC' },
    });

  describe('authentication', () => {
    const calls: [string, string][] = [
      ['get', '/projects/:id'],
      ['patch', '/projects/:id'],
      ['delete', '/projects/:id'],
      ['post', '/projects/:id/archive'],
      ['post', '/projects/:id/unarchive'],
      ['get', '/projects/:id/members'],
      ['patch', '/projects/:id/members/someone'],
      ['delete', '/projects/:id/members/someone'],
      ['post', '/projects/:id/transfer-ownership'],
    ];

    it.each(calls)(
      'rejects %s %s without a token with 401',
      async (verb, path) => {
        const url = path.replace(':id', UNKNOWN_UUID);
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

  describe('GET /projects/:projectId', () => {
    it('returns the project with the caller role and member count', async () => {
      const { owner, member, id } = await projectWithMember();

      const asOwner = await request(server)
        .get(`/projects/${id}`)
        .set(auth(owner));
      const asMember = await request(server)
        .get(`/projects/${id}`)
        .set(auth(member));

      expect(asOwner.status).toBe(200);
      expect(asOwner.body).toMatchObject({
        id,
        name: 'Homelab',
        meshProvider: 'Tailscale',
        role: 'owner',
        memberCount: 2,
        archivedAt: null,
      });
      expect(asMember.body).toMatchObject({ role: 'member', memberCount: 2 });
    });

    it('returns 404 to someone outside the project', async () => {
      const { id } = await createProject(uid());
      const res = await request(server)
        .get(`/projects/${id}`)
        .set(auth(uid('outsider')));
      expect(res.status).toBe(404);
    });

    it('returns 404 for a project that does not exist', async () => {
      const res = await request(server)
        .get(`/projects/${UNKNOWN_UUID}`)
        .set(auth(uid()));
      expect(res.status).toBe(404);
    });

    it('rejects a malformed id with 400', async () => {
      const res = await request(server)
        .get('/projects/not-a-uuid')
        .set(auth(uid()));
      expect(res.status).toBe(400);
    });

    it('still serves an archived project', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      await archive(owner, id);

      const res = await request(server).get(`/projects/${id}`).set(auth(owner));

      expect(res.status).toBe(200);
      expect(res.body.archivedAt).toBeTypeOf('string');
    });
  });

  describe('PATCH /projects/:projectId', () => {
    it('renames the project and trims the name', async () => {
      const owner = uid();
      const { id } = await createProject(owner, 'Old');

      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: '  New name  ' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, name: 'New name', role: 'owner' });
      const read = await request(server)
        .get(`/projects/${id}`)
        .set(auth(owner));
      expect(read.body.name).toBe('New name');
    });

    it('cannot change the mesh provider, whatever the body says', async () => {
      const owner = uid();
      const { id } = await createProject(owner, 'Mesh', 'Cloudflare');

      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'Mesh 2', meshProvider: 'Headscale', archivedAt: null });

      expect(res.status).toBe(200);
      expect(res.body.meshProvider).toBe('Cloudflare');
    });

    it.each([
      ['a missing name', {}],
      ['an empty name', { name: '' }],
      ['a blank name', { name: '    ' }],
      ['a numeric name', { name: 5 }],
      ['a null name', { name: null }],
      ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ])('rejects %s with 400', async (_label, body) => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send(body);
      expect(res.status).toBe(400);
    });

    it('accepts a name of exactly 100 characters', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'x'.repeat(100) });
      expect(res.status).toBe(200);
    });

    it('rejects a malformed id with 400', async () => {
      const res = await request(server)
        .patch('/projects/nope')
        .set(auth(uid()))
        .send({ name: 'x' });
      expect(res.status).toBe(400);
    });

    it('refuses a plain member with 403 and leaves the name alone', async () => {
      const { member, owner, id } = await projectWithMember();

      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(member))
        .send({ name: 'Hijacked' });

      expect(res.status).toBe(403);
      const read = await request(server)
        .get(`/projects/${id}`)
        .set(auth(owner));
      expect(read.body.name).toBe('Homelab');
    });

    it('returns 404 to an outsider', async () => {
      const { id } = await createProject(uid());
      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(uid('outsider')))
        .send({ name: 'x' });
      expect(res.status).toBe(404);
    });

    it('returns 409 while the project is archived and works again after unarchiving', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      await archive(owner, id);

      const blocked = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'Renamed' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toBe('Project is archived');

      await request(server).post(`/projects/${id}/unarchive`).set(auth(owner));
      const allowed = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'Renamed' });
      expect(allowed.status).toBe(200);
    });

    it('records project.updated for the rename and a denied entry for a refusal', async () => {
      const { member, owner, id } = await projectWithMember();
      await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'Audited' });
      await request(server)
        .patch(`/projects/${id}`)
        .set(auth(member))
        .send({ name: 'Nope' });

      const rows = await auditRows(id);

      const updated = rows.find((r) => r.action === 'project.updated');
      expect(updated).toMatchObject({ outcome: 'success', actorId: owner });
      expect(updated!.changes).toContain('Audited');
      const denied = rows.find(
        (r) => r.action === 'project.update' && r.outcome === 'denied',
      );
      expect(denied).toMatchObject({ actorId: member, entityId: id });
      expect(JSON.parse(denied!.metadata)).toMatchObject({
        reason: 'not_an_owner',
      });
    });

    it('records a denied entry, outside the project scope, for an outsider', async () => {
      const { id } = await createProject(uid());
      const outsider = uid('outsider');
      await request(server)
        .patch(`/projects/${id}`)
        .set(auth(outsider))
        .send({ name: 'x' });

      const row = await dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'project.update', actorId: outsider });

      expect(row.outcome).toBe('denied');
      expect(row.scope).toBeNull();
      expect(JSON.parse(row.metadata)).toMatchObject({
        reason: 'not_a_member',
      });
    });
  });

  describe('POST /projects/:projectId/archive and /unarchive', () => {
    it('archives and unarchives, returning the updated summary', async () => {
      const owner = uid();
      const { id } = await createProject(owner);

      const archived = await archive(owner, id);
      expect(archived.status).toBe(200);
      expect(archived.body).toMatchObject({
        id,
        role: 'owner',
        memberCount: 1,
      });
      expect(new Date(archived.body.archivedAt).getTime()).not.toBeNaN();

      const reopened = await request(server)
        .post(`/projects/${id}/unarchive`)
        .set(auth(owner));
      expect(reopened.status).toBe(200);
      expect(reopened.body.archivedAt).toBeNull();
    });

    it('reports the real member count', async () => {
      const { owner, id } = await projectWithMember();
      const res = await archive(owner, id);
      expect(res.body.memberCount).toBe(2);
    });

    it('returns 409 when archiving twice', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      await archive(owner, id);

      const res = await archive(owner, id);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Project is already archived');
    });

    it('returns 409 when unarchiving a project that is not archived', async () => {
      const owner = uid();
      const { id } = await createProject(owner);

      const res = await request(server)
        .post(`/projects/${id}/unarchive`)
        .set(auth(owner));

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Project is not archived');
    });

    it.each(['archive', 'unarchive'])(
      'refuses a plain member to %s with 403',
      async (verb) => {
        const { member, id } = await projectWithMember();
        const res = await request(server)
          .post(`/projects/${id}/${verb}`)
          .set(auth(member));
        expect(res.status).toBe(403);
      },
    );

    it.each(['archive', 'unarchive'])(
      'returns 404 to an outsider trying to %s',
      async (verb) => {
        const { id } = await createProject(uid());
        const res = await request(server)
          .post(`/projects/${id}/${verb}`)
          .set(auth(uid('outsider')));
        expect(res.status).toBe(404);
      },
    );

    it('rejects a malformed id with 400', async () => {
      const res = await request(server)
        .post('/projects/nope/archive')
        .set(auth(uid()));
      expect(res.status).toBe(400);
    });

    it('records denied attempts and the state changes', async () => {
      const { owner, member, id } = await projectWithMember();
      await request(server).post(`/projects/${id}/archive`).set(auth(member));
      await archive(owner, id);

      const rows = await auditRows(id);

      expect(
        rows.some(
          (r) => r.action === 'project.archive' && r.outcome === 'denied',
        ),
      ).toBe(true);
      const archivedChange = rows.filter(
        (r) =>
          r.action === 'project.updated' && r.changes?.includes('archivedAt'),
      );
      expect(archivedChange).toHaveLength(1);
    });
  });

  describe('archived projects are read-only', () => {
    async function archivedProject() {
      const owner = uid('owner');
      const member = uid('member');
      const target = uid('target');
      const { id } = await createProject(owner);
      await addMember(owner, id, member);
      await addMember(owner, id, target);
      await archive(owner, id);
      return { owner, member, target, id };
    }

    it('refuses to rename, invite, remove, change roles, transfer or accept', async () => {
      const owner = uid('owner');
      const target = uid('target');
      const joiner = uid('joiner');
      const { id } = await createProject(owner);
      await addMember(owner, id, target);
      const open = await request(server)
        .post(`/projects/${id}/invites`)
        .set(auth(owner))
        .send({});
      const token = (open.body.inviteLink as string).split('/').pop();
      await archive(owner, id);

      const attempts = [
        request(server).patch(`/projects/${id}`).send({ name: 'x' }),
        request(server).post(`/projects/${id}/invites`).send({}),
        request(server).delete(`/projects/${id}/members/${target}`),
        request(server)
          .patch(`/projects/${id}/members/${target}`)
          .send({ role: 'owner' }),
        request(server)
          .post(`/projects/${id}/transfer-ownership`)
          .send({ userId: target }),
      ];
      for (const attempt of attempts) {
        const res = await attempt.set(auth(owner));
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Project is archived');
      }

      const accept = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth(joiner));
      expect(accept.status).toBe(409);
      expect(accept.body.message).toBe('Project is archived');
    });

    it('keeps reads, leaving and unarchiving available', async () => {
      const { owner, member, id } = await archivedProject();

      const members = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(owner));
      const activity = await request(server)
        .get(`/projects/${id}/activity`)
        .set(auth(member));
      const invites = await request(server)
        .get(`/projects/${id}/invites`)
        .set(auth(owner));
      const leave = await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth(member));
      const reopen = await request(server)
        .post(`/projects/${id}/unarchive`)
        .set(auth(owner));

      expect(members.status).toBe(200);
      expect(activity.status).toBe(200);
      expect(invites.status).toBe(200);
      expect(leave.status).toBe(204);
      expect(reopen.status).toBe(200);
    });

    it('lets the owner delete an archived project', async () => {
      const { owner, id } = await archivedProject();
      const res = await request(server)
        .delete(`/projects/${id}`)
        .set(auth(owner));
      expect(res.status).toBe(204);
    });

    it('lets a plain member see the archived state, but not change it', async () => {
      const { member, id } = await archivedProject();
      const read = await request(server)
        .get(`/projects/${id}`)
        .set(auth(member));
      const reopen = await request(server)
        .post(`/projects/${id}/unarchive`)
        .set(auth(member));
      expect(read.body.archivedAt).toBeTypeOf('string');
      expect(reopen.status).toBe(403);
    });
  });

  describe('DELETE /projects/:projectId', () => {
    it('deletes the project for everyone and answers 204', async () => {
      const { owner, member, id } = await projectWithMember();

      const res = await request(server)
        .delete(`/projects/${id}`)
        .set(auth(owner));

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      for (const user of [owner, member]) {
        expect((await listOf(user)).body.items).toEqual([]);
        const read = await request(server)
          .get(`/projects/${id}`)
          .set(auth(user));
        expect(read.status).toBe(404);
        const members = await request(server)
          .get(`/projects/${id}/members`)
          .set(auth(user));
        expect(members.status).toBe(404);
        const activity = await request(server)
          .get(`/projects/${id}/activity`)
          .set(auth(user));
        expect(activity.status).toBe(404);
      }
    });

    it('soft-deletes the project, its members and its invites', async () => {
      const { owner, id } = await projectWithMember();
      await request(server)
        .post(`/projects/${id}/invites`)
        .set(auth(owner))
        .send({});

      await request(server).delete(`/projects/${id}`).set(auth(owner));

      const project = await dataSource
        .getRepository(Project)
        .findOne({ where: { id }, withDeleted: true });
      const members = await dataSource
        .getRepository(ProjectMember)
        .find({ where: { projectId: id }, withDeleted: true });
      const invites = await dataSource
        .getRepository(ProjectInvite)
        .find({ where: { projectId: id }, withDeleted: true });
      expect(project?.deletedAt).toBeInstanceOf(Date);
      expect(members).toHaveLength(2);
      expect(members.every((m) => m.deletedAt)).toBe(true);
      expect(invites).toHaveLength(2);
      expect(invites.every((i) => i.deletedAt)).toBe(true);
    });

    it('kills outstanding invite tokens', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      const invite = await request(server)
        .post(`/projects/${id}/invites`)
        .set(auth(owner))
        .send({});
      const token = (invite.body.inviteLink as string).split('/').pop();

      await request(server).delete(`/projects/${id}`).set(auth(owner));

      const joiner = uid('joiner');
      const preview = await request(server)
        .get(`/invites/${token}`)
        .set(auth(joiner));
      const accept = await request(server)
        .post(`/invites/${token}/accept`)
        .set(auth(joiner));
      expect(preview.status).toBe(400);
      expect(accept.status).toBe(400);
    });

    it('does not touch other projects of the same people', async () => {
      const { owner, member, id } = await projectWithMember();
      const other = await createProject(owner, 'Keeper');
      await addMember(owner, other.id, member);

      await request(server).delete(`/projects/${id}`).set(auth(owner));

      expect(namesOf(await listOf(owner))).toEqual(['Keeper']);
      expect(namesOf(await listOf(member))).toEqual(['Keeper']);
    });

    it('deletes a project that has several members and several invites', async () => {
      const { owner, id } = await projectWithMember();
      await addMember(owner, id, uid('third'));
      for (let i = 0; i < 3; i++) {
        await request(server)
          .post(`/projects/${id}/invites`)
          .set(auth(owner))
          .send({});
      }

      const before = (await auditRows(id)).map((r) => r.action);

      const res = await request(server)
        .delete(`/projects/${id}`)
        .set(auth(owner));

      expect(res.status).toBe(204);
      const actions = (await auditRows(id))
        .map((r) => r.action)
        .slice(before.length);
      expect(
        actions.filter((a) => a === 'project_invite.deleted'),
      ).toHaveLength(3);
      expect(
        actions.filter((a) => a === 'project_member.deleted'),
      ).toHaveLength(3);
    });

    it('returns 404 when deleting twice', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      await request(server).delete(`/projects/${id}`).set(auth(owner));
      const res = await request(server)
        .delete(`/projects/${id}`)
        .set(auth(owner));
      expect(res.status).toBe(404);
    });

    it('refuses a plain member with 403 and keeps the project', async () => {
      const { member, owner, id } = await projectWithMember();
      const res = await request(server)
        .delete(`/projects/${id}`)
        .set(auth(member));
      expect(res.status).toBe(403);
      expect((await listOf(owner)).body.total).toBe(1);
    });

    it('returns 404 to an outsider and rejects a malformed id', async () => {
      const { id } = await createProject(uid());
      const outsider = await request(server)
        .delete(`/projects/${id}`)
        .set(auth(uid('outsider')));
      const malformed = await request(server)
        .delete('/projects/nope')
        .set(auth(uid()));
      expect(outsider.status).toBe(404);
      expect(malformed.status).toBe(400);
    });

    it('records a denied project.delete for a member', async () => {
      const { member, id } = await projectWithMember();
      await request(server).delete(`/projects/${id}`).set(auth(member));
      const rows = await auditRows(id);
      expect(
        rows.some(
          (r) =>
            r.action === 'project.delete' &&
            r.outcome === 'denied' &&
            r.actorId === member,
        ),
      ).toBe(true);
    });

    it('records the soft deletes in the audit trail', async () => {
      const { owner, id } = await projectWithMember();
      await request(server).delete(`/projects/${id}`).set(auth(owner));
      const actions = (await auditRows(id)).map((r) => r.action);
      expect(actions).toContain('project.deleted');
      expect(
        actions.filter((a) => a === 'project_member.deleted'),
      ).toHaveLength(2);
    });
  });

  describe('GET /projects', () => {
    it('returns an empty page for a user without projects', async () => {
      const res = await listOf(uid());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
    });

    it('lists only the projects the user belongs to, with archivedAt', async () => {
      const a = uid();
      const b = uid();
      await createProject(a, 'Mine');
      await createProject(b, 'Theirs');

      const res = await listOf(a);

      expect(namesOf(res)).toEqual(['Mine']);
      expect(res.body.items[0]).toMatchObject({
        role: 'owner',
        memberCount: 1,
        archivedAt: null,
        meshProvider: 'Tailscale',
      });
    });

    it('reports the member count and role of each project', async () => {
      const owner = uid();
      const member = uid();
      const { id } = await createProject(owner, 'Shared');
      await addMember(owner, id, member);
      await createProject(member, 'Solo');

      const res = await listOf(member, '?sort=name');

      expect(
        res.body.items.map(
          (i: { name: string; role: string; memberCount: number }) => [
            i.name,
            i.role,
            i.memberCount,
          ],
        ),
      ).toEqual([
        ['Shared', 'member', 2],
        ['Solo', 'owner', 1],
      ]);
    });

    it('does not count removed members', async () => {
      const { owner, member, id } = await projectWithMember();
      await request(server)
        .delete(`/projects/${id}/members/${member}`)
        .set(auth(owner));
      expect((await listOf(owner)).body.items[0].memberCount).toBe(1);
    });

    describe('search', () => {
      it('matches part of a name regardless of case', async () => {
        const user = uid();
        await createProject(user, 'Production Cluster');
        await createProject(user, 'Staging');

        expect(namesOf(await listOf(user, '?q=CLUST'))).toEqual([
          'Production Cluster',
        ]);
        expect(namesOf(await listOf(user, '?q=ing'))).toEqual(['Staging']);
      });

      it('trims the search text and ignores a blank one', async () => {
        const user = uid();
        await createProject(user, 'Alpha');
        await createProject(user, 'Beta');

        expect(namesOf(await listOf(user, '?q=%20alpha%20'))).toEqual([
          'Alpha',
        ]);
        expect((await listOf(user, '?q=%20%20')).body.total).toBe(2);
        expect((await listOf(user, '?q=')).body.total).toBe(2);
      });

      it('returns nothing when nothing matches', async () => {
        const user = uid();
        await createProject(user, 'Alpha');
        const res = await listOf(user, '?q=zzz');
        expect(res.body).toMatchObject({ items: [], total: 0 });
      });

      it('treats % and _ and backslash literally', async () => {
        const user = uid();
        await createProject(user, '100% uptime');
        await createProject(user, 'a_b');
        await createProject(user, 'axb');
        await createProject(user, 'back\\slash');
        await createProject(user, 'plain');

        expect(namesOf(await listOf(user, '?q=%25'))).toEqual(['100% uptime']);
        expect(namesOf(await listOf(user, '?q=_'))).toEqual(['a_b']);
        expect(namesOf(await listOf(user, '?q=a_b'))).toEqual(['a_b']);
        expect(namesOf(await listOf(user, '?q=%5C'))).toEqual(['back\\slash']);
        expect(namesOf(await listOf(user, '?q=%25%25'))).toEqual([]);
      });

      it('does not let a search escape the caller own projects', async () => {
        const user = uid();
        await createProject(uid(), 'Foreign');
        const res = await listOf(user, '?q=%25');
        expect(res.body.total).toBe(0);
      });

      it('rejects a search over 100 characters', async () => {
        const res = await listOf(uid(), `?q=${'x'.repeat(101)}`);
        expect(res.status).toBe(400);
      });
    });

    describe('filters', () => {
      async function mixed() {
        const user = uid('mixed');
        const other = uid('other');
        const owned = await createProject(user, 'Owned');
        const joined = await createProject(other, 'Joined');
        await addMember(other, joined.id, user);
        const old = await createProject(user, 'Old');
        await archive(user, old.id);
        return { user, owned, joined, old };
      }

      it('filters by role', async () => {
        const { user } = await mixed();
        expect(
          namesOf(await listOf(user, '?role=owner&archived=include&sort=name')),
        ).toEqual(['Old', 'Owned']);
        expect(namesOf(await listOf(user, '?role=member'))).toEqual(['Joined']);
      });

      it('leaves archived projects out by default', async () => {
        const { user } = await mixed();
        const res = await listOf(user, '?sort=name');
        expect(namesOf(res)).toEqual(['Joined', 'Owned']);
        expect(res.body.total).toBe(2);
      });

      it('includes archived projects on request', async () => {
        const { user } = await mixed();
        const res = await listOf(user, '?archived=include&sort=name');
        expect(namesOf(res)).toEqual(['Joined', 'Old', 'Owned']);
        const old = res.body.items.find(
          (i: { name: string }) => i.name === 'Old',
        );
        expect(old.archivedAt).toBeTypeOf('string');
      });

      it('returns only archived projects on request', async () => {
        const { user } = await mixed();
        const res = await listOf(user, '?archived=only');
        expect(namesOf(res)).toEqual(['Old']);
        expect(res.body.total).toBe(1);
      });

      it('combines search, role and archived filters', async () => {
        const { user } = await mixed();
        const res = await listOf(user, '?q=o&role=owner&archived=only');
        expect(namesOf(res)).toEqual(['Old']);
        expect((await listOf(user, '?q=joined&role=owner')).body.total).toBe(0);
      });

      it('returns archived projects again once unarchived', async () => {
        const { user, old } = await mixed();
        await request(server)
          .post(`/projects/${old.id}/unarchive`)
          .set(auth(user));
        expect((await listOf(user)).body.total).toBe(3);
        expect((await listOf(user, '?archived=only')).body.total).toBe(0);
      });
    });

    describe('sorting', () => {
      async function dated() {
        const user = uid();
        const names = ['bravo', 'Alpha', 'charlie'];
        const base = Date.parse('2024-01-01T00:00:00Z');
        for (const [index, name] of names.entries()) {
          const { id } = await createProject(user, name);
          await dataSource
            .getRepository(Project)
            .update({ id }, { createdAt: new Date(base + index * 60_000) });
        }
        return user;
      }

      it('sorts by creation time ascending by default', async () => {
        const user = await dated();
        expect(namesOf(await listOf(user))).toEqual([
          'bravo',
          'Alpha',
          'charlie',
        ]);
      });

      it('sorts by creation time descending', async () => {
        const user = await dated();
        expect(
          namesOf(await listOf(user, '?sort=createdAt&order=desc')),
        ).toEqual(['charlie', 'Alpha', 'bravo']);
      });

      it('sorts by name ignoring case', async () => {
        const user = await dated();
        expect(namesOf(await listOf(user, '?sort=name'))).toEqual([
          'Alpha',
          'bravo',
          'charlie',
        ]);
        expect(namesOf(await listOf(user, '?sort=name&order=desc'))).toEqual([
          'charlie',
          'bravo',
          'Alpha',
        ]);
      });

      it('orders equal names deterministically', async () => {
        const user = uid();
        for (let i = 0; i < 4; i++) await createProject(user, 'same');
        const first = await listOf(user, '?sort=name');
        const second = await listOf(user, '?sort=name');
        const ids = (r: request.Response) =>
          r.body.items.map((i: { id: string }) => i.id);
        expect(ids(first)).toEqual(ids(second));
      });
    });

    describe('paging', () => {
      async function five() {
        const user = uid();
        for (const n of [1, 2, 3, 4, 5]) await createProject(user, `p${n}`);
        return user;
      }

      it('pages through the list with limit and offset', async () => {
        const user = await five();

        const first = await listOf(user, '?sort=name&limit=2');
        const second = await listOf(user, '?sort=name&limit=2&offset=2');
        const third = await listOf(user, '?sort=name&limit=2&offset=4');

        expect(namesOf(first)).toEqual(['p1', 'p2']);
        expect(namesOf(second)).toEqual(['p3', 'p4']);
        expect(namesOf(third)).toEqual(['p5']);
        expect(first.body).toMatchObject({ total: 5, limit: 2, offset: 0 });
        expect(second.body).toMatchObject({ total: 5, limit: 2, offset: 2 });
        expect(third.body).toMatchObject({ total: 5, limit: 2, offset: 4 });
      });

      it('returns an empty page, with the total, past the end', async () => {
        const user = await five();
        const res = await listOf(user, '?offset=50');
        expect(res.body).toEqual({
          items: [],
          total: 5,
          limit: 50,
          offset: 50,
        });
      });

      it('counts the total after filtering, not after paging', async () => {
        const user = await five();
        const res = await listOf(user, '?q=p&limit=1');
        expect(res.body.total).toBe(5);
        expect(res.body.items).toHaveLength(1);
      });

      it('accepts the limit bounds 1 and 100', async () => {
        const user = await five();
        expect((await listOf(user, '?limit=1')).status).toBe(200);
        expect((await listOf(user, '?limit=100')).body.limit).toBe(100);
      });

      it.each([
        'limit=0',
        'limit=101',
        'limit=-1',
        'limit=abc',
        'limit=1.5',
        'offset=-1',
        'offset=abc',
        'sort=size',
        'order=sideways',
        'archived=maybe',
        'role=admin',
      ])('rejects %s with 400', async (query) => {
        const res = await listOf(uid(), `?${query}`);
        expect(res.status).toBe(400);
      });

      it('ignores unknown query parameters', async () => {
        const res = await listOf(uid(), '?whatever=1');
        expect(res.status).toBe(200);
      });
    });
  });

  describe('GET /projects/:projectId/members', () => {
    it('lists members oldest first with roles and isYou', async () => {
      const owner = uid('owner');
      const second = uid('second');
      const third = uid('third');
      const { id } = await createProject(owner);
      await addMember(owner, id, second);
      await addMember(owner, id, third, 'owner');
      // Joins within the same millisecond would tie, so the join times are set apart
      const base = Date.parse('2024-01-01T00:00:00Z');
      for (const [index, userId] of [owner, second, third].entries()) {
        await dataSource
          .getRepository(ProjectMember)
          .update(
            { projectId: id, userId },
            { createdAt: new Date(base + index * 60_000) },
          );
      }

      const res = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(second));

      expect(res.status).toBe(200);
      expect(
        res.body.map((m: { userId: string; role: string; isYou: boolean }) => [
          m.userId,
          m.role,
          m.isYou,
        ]),
      ).toEqual([
        [owner, 'owner', false],
        [second, 'member', true],
        [third, 'owner', false],
      ]);
      expect(Object.keys(res.body[0]).sort()).toEqual([
        'displayName',
        'isYou',
        'joinedAt',
        'role',
        'userId',
        'username',
      ]);
      expect(new Date(res.body[0].joinedAt).getTime()).not.toBeNaN();
    });

    it('is open to a plain member and to an owner', async () => {
      const { owner, member, id } = await projectWithMember();
      for (const user of [owner, member]) {
        const res = await request(server)
          .get(`/projects/${id}/members`)
          .set(auth(user));
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
      }
    });

    it('returns 404 to an outsider and 400 for a malformed id', async () => {
      const { id } = await createProject(uid());
      const outsider = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(uid('outsider')));
      const malformed = await request(server)
        .get('/projects/nope/members')
        .set(auth(uid()));
      expect(outsider.status).toBe(404);
      expect(malformed.status).toBe(400);
    });

    it('drops members who left', async () => {
      const { owner, member, id } = await projectWithMember();
      await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth(member));
      const res = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(owner));
      expect(res.body.map((m: { userId: string }) => m.userId)).toEqual([
        owner,
      ]);
    });
  });

  describe('PATCH /projects/:projectId/members/:userId', () => {
    const changeRole = (
      actor: string,
      id: string,
      target: string,
      body: object,
    ) =>
      request(server)
        .patch(`/projects/${id}/members/${target}`)
        .set(auth(actor))
        .send(body);

    it('promotes a member to owner', async () => {
      const { owner, member, id } = await projectWithMember();

      const res = await changeRole(owner, id, member, { role: 'owner' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        userId: member,
        role: 'owner',
        isYou: false,
      });
      const asPromoted = await request(server)
        .get(`/projects/${id}`)
        .set(auth(member));
      expect(asPromoted.body.role).toBe('owner');
    });

    it('lets a promoted member exercise owner rights', async () => {
      const { owner, member, id } = await projectWithMember();
      await changeRole(owner, id, member, { role: 'owner' });
      const res = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(member))
        .send({ name: 'By new owner' });
      expect(res.status).toBe(200);
    });

    it('demotes an owner while another owner remains', async () => {
      const { owner, member, id } = await projectWithMember();
      await changeRole(owner, id, member, { role: 'owner' });

      const res = await changeRole(member, id, owner, { role: 'member' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('member');
      const denied = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'x' });
      expect(denied.status).toBe(403);
    });

    it.each([
      ['demote yourself while another owner exists', 'member', true],
      ['demote yourself as the only owner', 'member', false],
      ['set the role you already have', 'owner', false],
    ] as const)(
      'refuses an owner who tries to %s with 400',
      async (_name, role, hasSecondOwner) => {
        const { owner, member, id } = await projectWithMember();
        if (hasSecondOwner) {
          await changeRole(owner, id, member, { role: 'owner' });
        }
        const changes = async () =>
          (await auditRows(id)).filter(
            (r) => r.action === 'project_member.updated',
          ).length;
        const before = await changes();

        const res = await changeRole(owner, id, owner, { role });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/cannot change your own role/);
        const read = await request(server)
          .get(`/projects/${id}`)
          .set(auth(owner));
        expect(read.body.role).toBe('owner');
        expect(await changes()).toBe(before);
      },
    );

    it('still lets an owner change the role of somebody else, in both directions', async () => {
      const { owner, member, id } = await projectWithMember();

      const promoted = await changeRole(owner, id, member, { role: 'owner' });
      const demoted = await changeRole(member, id, owner, { role: 'member' });

      expect(promoted.status).toBe(200);
      expect(demoted.status).toBe(200);
      expect(demoted.body).toMatchObject({ userId: owner, role: 'member' });
    });

    it('keeps the last owner in place whoever asks', async () => {
      const { owner, member, id } = await projectWithMember();

      const bySelf = await changeRole(owner, id, owner, { role: 'member' });
      const byMember = await changeRole(member, id, owner, { role: 'member' });

      expect(bySelf.status).toBe(400);
      expect(byMember.status).toBe(403);
      const members = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(member));
      expect(
        members.body.filter((m: { role: string }) => m.role === 'owner'),
      ).toHaveLength(1);
    });

    it('is idempotent when the role does not change', async () => {
      const { owner, member, id } = await projectWithMember();
      const before = (await auditRows(id)).length;

      const same = await changeRole(owner, id, member, { role: 'member' });

      expect(same.status).toBe(200);
      expect(same.body.role).toBe('member');
      expect((await auditRows(id)).length).toBe(before);
    });

    it('returns 404 for a user who is not a member', async () => {
      const { owner, id } = await projectWithMember();
      const res = await changeRole(owner, id, 'ghost', { role: 'owner' });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Member not found');
    });

    it('returns 404 for a member who was removed', async () => {
      const { owner, member, id } = await projectWithMember();
      await request(server)
        .delete(`/projects/${id}/members/${member}`)
        .set(auth(owner));
      const res = await changeRole(owner, id, member, { role: 'owner' });
      expect(res.status).toBe(404);
    });

    it.each([
      ['a missing role', {}],
      ['an unknown role', { role: 'admin' }],
      ['a numeric role', { role: 1 }],
      ['a null role', { role: null }],
      ['an upper-case role', { role: 'OWNER' }],
    ])('rejects %s with 400', async (_label, body) => {
      const { owner, member, id } = await projectWithMember();
      const res = await changeRole(owner, id, member, body);
      expect(res.status).toBe(400);
    });

    it('ignores unknown fields in the body', async () => {
      const { owner, member, id } = await projectWithMember();
      const res = await changeRole(owner, id, member, {
        role: 'owner',
        userId: owner,
        projectId: UNKNOWN_UUID,
      });
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(member);
    });

    it('refuses a plain member with 403, including changing their own role', async () => {
      const { member, owner, id } = await projectWithMember();
      const self = await changeRole(member, id, member, { role: 'owner' });
      const other = await changeRole(member, id, owner, { role: 'member' });
      expect(self.status).toBe(403);
      expect(other.status).toBe(403);
      const read = await request(server)
        .get(`/projects/${id}`)
        .set(auth(member));
      expect(read.body.role).toBe('member');
    });

    it('returns 404 to an outsider and 400 for a malformed project id', async () => {
      const { member, id } = await projectWithMember();
      const outsider = await changeRole(uid('outsider'), id, member, {
        role: 'owner',
      });
      const malformed = await changeRole(uid(), 'nope', member, {
        role: 'owner',
      });
      expect(outsider.status).toBe(404);
      expect(malformed.status).toBe(400);
    });

    it('records project_member.updated and a denied entry', async () => {
      const { owner, member, id } = await projectWithMember();
      await changeRole(member, id, member, { role: 'owner' });
      await changeRole(owner, id, member, { role: 'owner' });

      const rows = await auditRows(id);

      const updated = rows.find((r) => r.action === 'project_member.updated');
      expect(updated).toMatchObject({ outcome: 'success', actorId: owner });
      expect(updated!.changes).toContain('owner');
      expect(
        rows.some(
          (r) =>
            r.action === 'project.member.update' &&
            r.outcome === 'denied' &&
            r.actorId === member,
        ),
      ).toBe(true);
    });
  });

  describe('DELETE /projects/:projectId/members/:userId', () => {
    const removeMember = (actor: string, id: string, target: string) =>
      request(server)
        .delete(`/projects/${id}/members/${target}`)
        .set(auth(actor));

    it('removes the member, who loses access', async () => {
      const { owner, member, id } = await projectWithMember();

      const res = await removeMember(owner, id, member);

      expect(res.status).toBe(204);
      expect((await listOf(member)).body.items).toEqual([]);
      const read = await request(server)
        .get(`/projects/${id}`)
        .set(auth(member));
      expect(read.status).toBe(404);
      const members = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(owner));
      expect(members.body).toHaveLength(1);
    });

    it('can remove another owner', async () => {
      const owner = uid('owner');
      const second = uid('second');
      const { id } = await createProject(owner);
      await addMember(owner, id, second, 'owner');
      expect((await removeMember(owner, id, second)).status).toBe(204);
    });

    it('lets a removed member rejoin with a new invite', async () => {
      const { owner, member, id } = await projectWithMember();
      await removeMember(owner, id, member);
      await addMember(owner, id, member);
      expect((await listOf(member)).body.total).toBe(1);
    });

    it('refuses to remove yourself with 400', async () => {
      const { owner, id } = await projectWithMember();
      const res = await removeMember(owner, id, owner);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Use leave to remove yourself');
    });

    it('returns 404 for an unknown user and for one already removed', async () => {
      const { owner, member, id } = await projectWithMember();
      const unknown = await removeMember(owner, id, 'ghost');
      await removeMember(owner, id, member);
      const again = await removeMember(owner, id, member);
      expect(unknown.status).toBe(404);
      expect(again.status).toBe(404);
    });

    it('refuses a plain member with 403, even to remove themselves', async () => {
      const { owner, member, id } = await projectWithMember();
      const other = await removeMember(member, id, owner);
      const self = await removeMember(member, id, member);
      expect(other.status).toBe(403);
      expect(self.status).toBe(403);
      expect((await listOf(owner)).body.items[0].memberCount).toBe(2);
    });

    it('returns 404 to an outsider and 400 for a malformed project id', async () => {
      const { member, id } = await projectWithMember();
      expect((await removeMember(uid('outsider'), id, member)).status).toBe(
        404,
      );
      expect((await removeMember(uid(), 'nope', member)).status).toBe(400);
    });

    it('records project_member.deleted with the actor, and a denied attempt', async () => {
      const { owner, member, id } = await projectWithMember();
      await removeMember(member, id, owner);
      await removeMember(owner, id, member);

      const rows = await auditRows(id);

      expect(
        rows.find((r) => r.action === 'project_member.deleted'),
      ).toMatchObject({ outcome: 'success', actorId: owner });
      expect(
        rows.some(
          (r) =>
            r.action === 'project.member.remove' &&
            r.outcome === 'denied' &&
            r.actorId === member,
        ),
      ).toBe(true);
    });
  });

  describe('POST /projects/:projectId/transfer-ownership', () => {
    const transfer = (actor: string, id: string, body: object) =>
      request(server)
        .post(`/projects/${id}/transfer-ownership`)
        .set(auth(actor))
        .send(body);

    it('makes the target an owner and the caller a member', async () => {
      const { owner, member, id } = await projectWithMember();

      const res = await transfer(owner, id, { userId: member });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        role: 'member',
        memberCount: 2,
        archivedAt: null,
      });
      const members = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(member));
      const roles = Object.fromEntries(
        members.body.map((m: { userId: string; role: string }) => [
          m.userId,
          m.role,
        ]),
      );
      expect(roles).toEqual({ [owner]: 'member', [member]: 'owner' });
    });

    it('takes owner rights from the previous owner', async () => {
      const { owner, member, id } = await projectWithMember();
      await transfer(owner, id, { userId: member });

      const rename = await request(server)
        .patch(`/projects/${id}`)
        .set(auth(owner))
        .send({ name: 'x' });
      const invites = await request(server)
        .get(`/projects/${id}/invites`)
        .set(auth(owner));
      const again = await transfer(owner, id, { userId: member });

      expect(rename.status).toBe(403);
      expect(invites.status).toBe(403);
      expect(again.status).toBe(403);
    });

    it('lets the new owner take the project back', async () => {
      const { owner, member, id } = await projectWithMember();
      await transfer(owner, id, { userId: member });
      const res = await transfer(member, id, { userId: owner });
      expect(res.status).toBe(200);
      expect((await listOf(owner)).body.items[0].role).toBe('owner');
    });

    it('keeps the project alive when the previous owner then leaves', async () => {
      const { owner, member, id } = await projectWithMember();
      await transfer(owner, id, { userId: member });

      const leave = await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth(owner));

      expect(leave.status).toBe(204);
      expect((await listOf(owner)).body.items).toEqual([]);
      const remaining = await listOf(member);
      expect(remaining.body.items[0]).toMatchObject({
        id,
        role: 'owner',
        memberCount: 1,
      });
    });

    it('refuses to hand the project to yourself with 400', async () => {
      const { owner, id } = await projectWithMember();
      const res = await transfer(owner, id, { userId: owner });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('You already own this project');
    });

    it('returns 404 for someone who is not a member', async () => {
      const { owner, id } = await projectWithMember();
      const res = await transfer(owner, id, { userId: 'ghost' });
      expect(res.status).toBe(404);
    });

    it('returns 409 when the target already owns the project', async () => {
      const owner = uid('owner');
      const second = uid('second');
      const { id } = await createProject(owner);
      await addMember(owner, id, second, 'owner');
      const res = await transfer(owner, id, { userId: second });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('That member is already an owner');
    });

    it.each([
      ['a missing userId', {}],
      ['an empty userId', { userId: '' }],
      ['a numeric userId', { userId: 5 }],
      ['a null userId', { userId: null }],
      ['a userId over 100 characters', { userId: 'x'.repeat(101) }],
    ])('rejects %s with 400', async (_label, body) => {
      const { owner, id } = await projectWithMember();
      const res = await transfer(owner, id, body);
      expect(res.status).toBe(400);
    });

    it('ignores unknown fields in the body', async () => {
      const { owner, member, id } = await projectWithMember();
      const res = await transfer(owner, id, {
        userId: member,
        role: 'member',
        extra: 1,
      });
      expect(res.status).toBe(200);
    });

    it('refuses a plain member with 403 even when targeting themselves', async () => {
      const { owner, member, id } = await projectWithMember();
      const res = await transfer(member, id, { userId: member });
      expect(res.status).toBe(403);
      expect((await listOf(owner)).body.items[0].role).toBe('owner');
    });

    it('returns 404 to an outsider and 400 for a malformed project id', async () => {
      const { member, id } = await projectWithMember();
      expect(
        (await transfer(uid('outsider'), id, { userId: member })).status,
      ).toBe(404);
      expect((await transfer(uid(), 'nope', { userId: member })).status).toBe(
        400,
      );
    });

    it('records both role changes and a denied attempt', async () => {
      const { owner, member, id } = await projectWithMember();
      await transfer(member, id, { userId: member });
      await transfer(owner, id, { userId: member });

      const rows = await auditRows(id);

      const updates = rows.filter((r) => r.action === 'project_member.updated');
      expect(updates).toHaveLength(2);
      expect(updates.every((r) => r.actorId === owner)).toBe(true);
      expect(
        rows.some(
          (r) =>
            r.action === 'project.transfer' &&
            r.outcome === 'denied' &&
            r.actorId === member,
        ),
      ).toBe(true);
    });
  });

  describe('last-owner invariants', () => {
    it('deletes the project when the last member leaves with several open invites', async () => {
      const owner = uid();
      const { id } = await createProject(owner);
      for (let i = 0; i < 3; i++) {
        await request(server)
          .post(`/projects/${id}/invites`)
          .set(auth(owner))
          .send({});
      }

      const res = await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth(owner));

      expect(res.status).toBe(204);
      expect(await dataSource.getRepository(Project).existsBy({ id })).toBe(
        false,
      );
    });

    it('never leaves a project without an owner across role changes and leaving', async () => {
      const owner = uid('owner');
      const a = uid('a');
      const b = uid('b');
      const { id } = await createProject(owner);
      await addMember(owner, id, a);
      await addMember(owner, id, b);

      await request(server)
        .patch(`/projects/${id}/members/${a}`)
        .set(auth(owner))
        .send({ role: 'owner' });
      const demoteOther = await request(server)
        .patch(`/projects/${id}/members/${owner}`)
        .set(auth(a))
        .send({ role: 'member' });
      const demoteSelf = await request(server)
        .patch(`/projects/${id}/members/${a}`)
        .set(auth(a))
        .send({ role: 'member' });
      await request(server).delete(`/projects/${id}/membership`).set(auth(a));

      expect(demoteOther.status).toBe(200);
      expect(demoteSelf.status).toBe(400);
      const members = await request(server)
        .get(`/projects/${id}/members`)
        .set(auth(b));
      expect(
        members.body.filter((m: { role: string }) => m.role === 'owner'),
      ).toHaveLength(1);
    });
  });
});
