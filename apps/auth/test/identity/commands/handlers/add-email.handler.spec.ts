import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

// import commands
import { AddEmailCommand } from '../../../../src/identity/commands/add-email.command.js';
import { AddEmailHandler } from '../../../../src/identity/commands/handlers/add-email.handler.js';
import { MAX_EMAILS_PER_ACCOUNT } from '../../../../src/identity/commands/handlers/add-email.handler.js';

const lost = () =>
  new QueryFailedError(
    'INSERT',
    [],
    new Error('UNIQUE constraint failed: emails.email'),
  );

describe('AddEmailHandler', () => {
  const command = new AddEmailCommand('user-1', 'new@example.com');
  const repository = {
    countBy: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn((value: object) => value),
    save: vi.fn(),
  };
  const audit = { record: vi.fn() };
  const handler = new AddEmailHandler(repository as never, audit as never);

  beforeEach(() => {
    repository.countBy.mockReset().mockResolvedValue(1);
    repository.findOne.mockReset().mockResolvedValue(null);
    repository.save.mockReset().mockImplementation(async (value: object) => ({
      id: 'new-id',
      ...value,
    }));
    audit.record.mockReset();
  });

  it('adds a free address as an unverified secondary one', async () => {
    const added = await handler.execute(command);

    expect(added).toEqual({
      id: 'new-id',
      email: 'new@example.com',
      isPrimary: false,
      isVerified: false,
      providedBy: null,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers an address another account holds exactly like a free one, adding nothing', async () => {
    repository.findOne.mockResolvedValue({
      id: 'held-id',
      userId: 'someone-else',
      email: 'new@example.com',
    });

    const added = await handler.execute(command);

    expect(Object.keys(added).sort()).toEqual([
      'email',
      'id',
      'isPrimary',
      'isVerified',
      'providedBy',
    ]);
    expect(added).toMatchObject({ isPrimary: false, isVerified: false });
    expect(added.id).not.toBe('held-id');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('tells the holder, not the asker, that someone tried', async () => {
    repository.findOne.mockResolvedValue({
      id: 'held-id',
      userId: 'someone-else',
      email: 'new@example.com',
    });

    await handler.execute(command);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.email.add_blocked',
        outcome: 'denied',
        entityId: 'held-id',
        scope: 'user:someone-else',
      }),
    );
  });

  it("says plainly when the address is already on the asker's own account", async () => {
    repository.findOne.mockResolvedValue({
      id: 'mine',
      userId: 'user-1',
      email: 'new@example.com',
    });

    const error = await handler.execute(command).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    // The browser shows this text as is
    expect((error as ConflictException).message).toBe('Email already in use');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats losing the race for an address like finding it held already', async () => {
    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'held-id', userId: 'someone-else' });
    repository.save.mockRejectedValue(lost());

    const added = await handler.execute(command);

    expect(added.email).toBe('new@example.com');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the same account adds the address twice at once', async () => {
    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'mine', userId: 'user-1' });
    repository.save.mockRejectedValue(lost());

    await expect(handler.execute(command)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses another address once the account is at its limit, whoever holds it', async () => {
    repository.countBy.mockResolvedValue(MAX_EMAILS_PER_ACCOUNT);
    repository.findOne.mockResolvedValue({
      id: 'held',
      userId: 'someone-else',
    });

    await expect(handler.execute(command)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets any other failure through unchanged', async () => {
    const broken = new Error('disk full');
    repository.save.mockRejectedValue(broken);

    await expect(handler.execute(command)).rejects.toBe(broken);
  });
});
