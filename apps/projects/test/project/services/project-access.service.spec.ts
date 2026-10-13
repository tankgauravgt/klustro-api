import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';

// import services
import { ProjectAccessService } from '../../../src/project/services/project-access.service.js';

const setup = (membership: object | null) => {
  const findOne = vi.fn(async () => membership);
  const manager = { getRepository: vi.fn(() => ({ findOne })) };
  const otherManager = { getRepository: vi.fn(() => ({ findOne })) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new ProjectAccessService(
    { manager } as never,
    audit as never,
  );
  return { service, findOne, manager, otherManager, audit };
};

const owner = { role: 'owner', project: { id: 'p1', archivedAt: null } };
const member = { role: 'member', project: { id: 'p1', archivedAt: null } };

describe('ProjectAccessService.requireMember', () => {
  it('returns the project and the membership of a member', async () => {
    const { service, findOne } = setup(member);

    const access = await service.requireMember('u1', 'p1');

    expect(access).toEqual({ project: member.project, membership: member });
    expect(findOne).toHaveBeenCalledWith({
      where: { projectId: 'p1', userId: 'u1' },
      relations: { project: true },
    });
  });

  it('answers 404 for someone who is not a member', async () => {
    const { service } = setup(null);
    await expect(service.requireMember('u1', 'p1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('answers 404 when the project is gone although the membership remains', async () => {
    const { service } = setup({ role: 'owner', project: null });
    await expect(service.requireMember('u1', 'p1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('uses the given manager instead of the default one', async () => {
    const { service, manager, otherManager } = setup(member);

    await service.requireMember('u1', 'p1', otherManager as never);

    expect(otherManager.getRepository).toHaveBeenCalled();
    expect(manager.getRepository).not.toHaveBeenCalled();
  });

  it('records nothing in the audit trail', async () => {
    const { service, audit } = setup(null);
    await service.requireMember('u1', 'p1').catch(() => undefined);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ProjectAccessService.requireOwner', () => {
  let ctx: ReturnType<typeof setup>;

  describe('as an owner', () => {
    beforeEach(() => {
      ctx = setup(owner);
    });

    it('returns the access and records nothing', async () => {
      const access = await ctx.service.requireOwner('u1', 'p1', 'project.x');
      expect(access.membership).toBe(owner);
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it('uses the given manager', async () => {
      await ctx.service.requireOwner(
        'u1',
        'p1',
        'project.x',
        ctx.otherManager as never,
      );
      expect(ctx.otherManager.getRepository).toHaveBeenCalled();
      expect(ctx.manager.getRepository).not.toHaveBeenCalled();
    });
  });

  describe('as a plain member', () => {
    beforeEach(() => {
      ctx = setup(member);
    });

    it('answers 403 and records a denied event in the project scope', async () => {
      await expect(
        ctx.service.requireOwner('u1', 'p1', 'project.update'),
      ).rejects.toThrow(ForbiddenException);

      expect(ctx.audit.record).toHaveBeenCalledWith({
        action: 'project.update',
        outcome: 'denied',
        entityType: 'project',
        entityId: 'p1',
        scope: 'project:p1',
        metadata: { reason: 'not_an_owner' },
      });
    });

    it('records the denial before throwing, exactly once', async () => {
      await ctx.service
        .requireOwner('u1', 'p1', 'project.update')
        .catch(() => undefined);
      expect(ctx.audit.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('as an outsider', () => {
    beforeEach(() => {
      ctx = setup(null);
    });

    it('answers 404 and records a denied event without a scope', async () => {
      await expect(
        ctx.service.requireOwner('u1', 'p1', 'project.delete'),
      ).rejects.toThrow(NotFoundException);

      expect(ctx.audit.record).toHaveBeenCalledWith({
        action: 'project.delete',
        outcome: 'denied',
        entityType: 'project',
        entityId: 'p1',
        metadata: { reason: 'not_a_member' },
      });
    });
  });

  it('lets unexpected errors through without auditing them as denials', async () => {
    const { service, findOne, audit } = setup(owner);
    findOne.mockRejectedValueOnce(new Error('database down'));

    await expect(service.requireOwner('u1', 'p1', 'project.x')).rejects.toThrow(
      'database down',
    );

    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ProjectAccessService.assertActive', () => {
  const { service } = setup(null);

  it('allows a project that is not archived', () => {
    expect(() =>
      service.assertActive({ archivedAt: null } as never),
    ).not.toThrow();
    expect(() =>
      service.assertActive({ archivedAt: undefined } as never),
    ).not.toThrow();
  });

  it('answers 409 for an archived project', () => {
    expect(() =>
      service.assertActive({ archivedAt: new Date() } as never),
    ).toThrow(ConflictException);
    expect(() =>
      service.assertActive({ archivedAt: new Date() } as never),
    ).toThrow('Project is archived');
  });
});
