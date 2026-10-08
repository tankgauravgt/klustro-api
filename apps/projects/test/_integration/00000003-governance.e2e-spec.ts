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
import { AuditService } from '@libs/governance';
import type { AuditLogEntry } from '@libs/governance';

// import applications
import { ProjectsModule } from '@apps/projects';
import { AuthSessionService } from '../../src/identity/index.js';

// import features
import { Project } from '../../src/project/index.js';
import { ProjectInvite } from '../../src/project/index.js';
import { ProjectMember } from '../../src/project/index.js';

/**
 * Covers the governance model of the projects service: every change is
 * audited in the same transaction, nothing is hard-deleted, the audit log is
 * append-only and hash-chained, and each record names who touched it.
 */
describe('Projects governance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;
  let audit: AuditService;
  let jwt: JwtService;

  const auth = (userId: string) => ({
    Authorization: `Bearer ${jwt.sign({ sub: userId })}`,
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
    audit = moduleRef.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProject(userId: string, requestId?: string) {
    const call = request(server).post('/projects').set(auth(userId));
    if (requestId) call.set('x-request-id', requestId);
    const res = await call.send({
      name: 'Governed',
      meshProvider: 'Tailscale',
    });
    return res.body as { id: string };
  }

  async function invite(ownerId: string, projectId: string): Promise<string> {
    const res = await request(server)
      .post(`/projects/${projectId}/invites`)
      .set(auth(ownerId))
      .send({});
    return (res.body.inviteLink as string).split('/').pop() as string;
  }

  async function join(userId: string, token: string) {
    return request(server).post(`/invites/${token}/accept`).set(auth(userId));
  }

  async function trail(ownerId: string, projectId: string, query = '') {
    const res = await request(server)
      .get(`/projects/${projectId}/audit-logs${query}`)
      .set(auth(ownerId));
    return res;
  }

  const actionsOf = (items: AuditLogEntry[]): string[] =>
    items.map((item) => item.action);

  describe('audit trail', () => {
    it('records who did what, with the request id, for a new project', async () => {
      const { id } = await createProject('gov-owner', 'req-create-0001');

      const res = await trail('gov-owner', id);

      expect(res.status).toBe(200);
      const items: AuditLogEntry[] = res.body.items;
      expect(actionsOf(items)).toEqual(
        expect.arrayContaining(['project.created', 'project_member.created']),
      );
      const created = items.find((i) => i.action === 'project.created')!;
      expect(created).toMatchObject({
        outcome: 'success',
        actorId: 'gov-owner',
        actorType: 'user',
        entityType: 'project',
        entityId: id,
        service: 'projects',
      });
      expect(created.metadata).toMatchObject({
        requestId: 'req-create-0001',
        operation: 'ProjectController.create',
      });
      expect(created.changes).toMatchObject({
        after: { name: 'Governed', meshProvider: 'Tailscale' },
      });
    });

    it('echoes a generated request id on every response', async () => {
      const res = await request(server).get('/projects').set(auth('anyone'));
      expect(res.headers['x-request-id']).toBeTypeOf('string');
    });

    it('never stores secrets: invite token hashes are redacted', async () => {
      const { id } = await createProject('redact-owner');
      await invite('redact-owner', id);

      const res = await trail('redact-owner', id);
      const created = (res.body.items as AuditLogEntry[]).find(
        (i) => i.action === 'project_invite.created',
      )!;
      expect(created.changes).toMatchObject({
        after: { tokenHash: '[REDACTED]' },
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /[0-9a-f]{64}"\s*[,}]\s*"createdByUserId/,
      );
    });

    it('records role changes as field-level before/after with the actor', async () => {
      const { id } = await createProject('promo-owner');
      await join('promo-heir', await invite('promo-owner', id));
      await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('promo-owner'));

      const res = await trail('promo-heir', id);
      const promotion = (res.body.items as AuditLogEntry[]).find(
        (i) => i.action === 'project_member.updated',
      )!;
      expect(promotion.changes).toEqual({
        fields: { role: { from: 'member', to: 'owner' } },
      });
      expect(promotion.actorId).toBe('promo-owner');
    });

    it('records refused actions as denied or failed outcomes', async () => {
      const { id } = await createProject('deny-owner');
      await join('deny-member', await invite('deny-owner', id));

      const denied = await request(server)
        .post(`/projects/${id}/invites`)
        .set(auth('deny-member'))
        .send({});
      expect(denied.status).toBe(403);

      const rejected = await join('deny-stranger', 'not-a-real-token');
      expect(rejected.status).toBe(400);

      const res = await trail('deny-owner', id);
      const refusal = (res.body.items as AuditLogEntry[]).find(
        (i) => i.action === 'project.invite.create',
      )!;
      expect(refusal).toMatchObject({
        outcome: 'denied',
        actorId: 'deny-member',
        metadata: { reason: 'not_an_owner' },
      });

      const failed = await dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'project.invite.accept' });
      expect(failed).toMatchObject({
        outcome: 'failure',
        actorId: 'deny-stranger',
      });
    });

    it('pages through the trail newest first', async () => {
      const { id } = await createProject('page-owner');
      await invite('page-owner', id);
      await invite('page-owner', id);

      const first = await trail('page-owner', id, '?limit=2');
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextBefore).toBeTypeOf('number');
      const [a, b] = first.body.items as AuditLogEntry[];
      expect(a.sequence).toBeGreaterThan(b.sequence);

      const second = await trail(
        'page-owner',
        id,
        `?limit=2&before=${first.body.nextBefore}`,
      );
      expect(
        (second.body.items as AuditLogEntry[]).every(
          (i) => i.sequence < first.body.nextBefore,
        ),
      ).toBe(true);
    });

    it('limits the trail to owners of that project', async () => {
      const { id } = await createProject('acl-owner');
      await join('acl-member', await invite('acl-owner', id));

      expect((await trail('acl-member', id)).status).toBe(403);
      expect((await trail('acl-stranger', id)).status).toBe(404);
      expect((await trail('acl-owner', id)).status).toBe(200);
    });
  });

  describe('soft delete', () => {
    it('keeps a left membership with who removed it and when', async () => {
      const { id } = await createProject('soft-owner');
      await join('soft-leaver', await invite('soft-owner', id));
      await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('soft-leaver'));

      const row = await dataSource.getRepository(ProjectMember).findOneOrFail({
        where: { projectId: id, userId: 'soft-leaver' },
        withDeleted: true,
      });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.deletedBy).toBe('soft-leaver');
      expect(row.createdBy).toBe('soft-leaver');
    });

    it('keeps the project, members and invites when the last member leaves', async () => {
      const { id } = await createProject('last-owner');
      await invite('last-owner', id);
      await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('last-owner'));

      const project = await dataSource
        .getRepository(Project)
        .findOneOrFail({ where: { id }, withDeleted: true });
      expect(project.deletedAt).toBeInstanceOf(Date);
      expect(project.deletedBy).toBe('last-owner');

      const invites = await dataSource
        .getRepository(ProjectInvite)
        .find({ where: { projectId: id }, withDeleted: true });
      expect(invites).toHaveLength(1);
      expect(invites[0].deletedAt).toBeInstanceOf(Date);

      expect(await dataSource.getRepository(Project).existsBy({ id })).toBe(
        false,
      );
    });

    it('audits the deletion with the state it had before', async () => {
      const { id } = await createProject('audit-del-owner');
      await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('audit-del-owner'));

      const deleted = await dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'project.deleted', entityId: id });
      expect(deleted.actorId).toBe('audit-del-owner');
      expect(JSON.parse(deleted.changes as string)).toMatchObject({
        before: { name: 'Governed', meshProvider: 'Tailscale' },
      });
    });

    it('keeps a consumed invite instead of deleting it', async () => {
      const { id } = await createProject('consume-owner');
      await join('consume-joiner', await invite('consume-owner', id));

      const invites = await dataSource
        .getRepository(ProjectInvite)
        .find({ where: { projectId: id }, withDeleted: true });
      expect(invites).toHaveLength(1);
      expect(invites[0].deletedBy).toBe('consume-joiner');
    });

    it('lets a user rejoin after leaving without unique-key clashes', async () => {
      const { id } = await createProject('rejoin-owner');
      await join('rejoiner', await invite('rejoin-owner', id));
      await request(server)
        .delete(`/projects/${id}/membership`)
        .set(auth('rejoiner'));

      const again = await join('rejoiner', await invite('rejoin-owner', id));
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id, role: 'member' });
    });
  });

  describe('tamper resistance', () => {
    it('refuses to hard-delete governed records', async () => {
      const { id } = await createProject('hard-owner');
      const repository = dataSource.getRepository(Project);
      const project = await repository.findOneByOrFail({ id });

      await expect(repository.remove(project)).rejects.toThrow(/forbidden/);
      await expect(
        dataSource.query('DELETE FROM projects WHERE id = ?', [id]),
      ).rejects.toThrow(/hard deletes are forbidden/);
      expect(await repository.existsBy({ id })).toBe(true);
    });

    it('refuses to rewrite or remove audit entries', async () => {
      await createProject('append-owner');

      await expect(
        dataSource.query("UPDATE audit_logs SET action = 'forged'"),
      ).rejects.toThrow(/append-only/);
      await expect(dataSource.query('DELETE FROM audit_logs')).rejects.toThrow(
        /append-only/,
      );
    });

    it('verifies an intact chain, then pinpoints the first tampered entry', async () => {
      await createProject('chain-owner');
      await createProject('chain-owner');

      const intact = await audit.verifyIntegrity();
      expect(intact.valid).toBe(true);
      expect(intact.checked).toBeGreaterThan(5);

      // Simulate an attacker with raw database access who also drops the guard
      await dataSource.query('DROP TRIGGER governance_update_audit_logs');
      await dataSource.query(
        "UPDATE audit_logs SET action = 'forged' WHERE sequence = 3",
      );

      expect(await audit.verifyIntegrity()).toEqual({
        valid: false,
        checked: 2,
        brokenAtSequence: 3,
      });
    });
  });
});
