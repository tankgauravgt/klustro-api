import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

// import commands
import { SignUpCommand } from '../../../../src/trust/commands/sign-up.command.js';
import { SignUpHandler } from '../../../../src/trust/commands/handlers/sign-up.handler.js';

const refusedWith = (message: string) => {
  const dataSource = {
    transaction: async () => {
      throw new QueryFailedError('INSERT', [], new Error(message));
    },
  };
  return new SignUpHandler(
    dataSource as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
};

describe('SignUpHandler when two sign-ups race', () => {
  const command = new SignUpCommand({
    username: 'jane',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    password: 'secret123',
  });

  it('answers 409 for the username the other request took first', async () => {
    const error = await refusedWith('UNIQUE constraint failed: users.username')
      .execute(command)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe('Username already taken');
  });

  it('answers 409 for the email the other request took first', async () => {
    const error = await refusedWith('UNIQUE constraint failed: emails.email')
      .execute(command)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe('Email already in use');
  });
});

describe('SignUpHandler when the email already has an account', () => {
  const command = (existingAccountPassword?: string) =>
    new SignUpCommand({
      username: 'jane',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'secret123',
      existingAccountPassword,
    });

  const repository = {
    findOne: async () => null,
    create: (value: object) => value,
    save: async (value: object) => value,
  };
  const passwords = {
    verify: vi.fn(),
    verifyDecoy: vi.fn(),
    hash: vi.fn(async () => 'hashed'),
  };
  const commandBus = { execute: vi.fn(async () => 'token') };
  const claims = { find: vi.fn(), releaseUnverified: vi.fn() };
  const audit = { record: vi.fn() };
  const verification = {
    issue: vi.fn(async () => 'raw-token'),
    sendVerificationEmail: vi.fn(),
  };
  const handler = new SignUpHandler(
    {
      transaction: async (run: (m: unknown) => unknown) =>
        run({ getRepository: () => repository }),
    } as never,
    passwords as never,
    commandBus as never,
    claims as never,
    audit as never,
    { setActor: vi.fn() } as never,
    verification as never,
  );

  const owner = (overrides: object = {}) => ({
    id: 'owner-1',
    passwordHash: 'stored-hash',
    isEmailVerified: true,
    isActive: true,
    requiresPasswordSetup: false,
    ...overrides,
  });
  const heldBy = (user: object) =>
    claims.find.mockResolvedValue({
      kind: 'held',
      email: { isVerified: true },
      owner: user,
    });
  const denied = () =>
    audit.record.mock.calls.filter(([event]) => event.outcome === 'denied');

  beforeEach(() => {
    for (const mock of [
      passwords.verify,
      passwords.verifyDecoy,
      claims.find,
      audit.record,
    ]) {
      mock.mockReset();
    }
    passwords.verifyDecoy.mockResolvedValue(false);
  });

  it('asks for the password, and tells the owner someone asked', async () => {
    heldBy(owner());

    const result = await handler.execute(command());

    expect(result).toEqual({ status: 'password_required' });
    expect(denied()).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.signup.existing_account',
        outcome: 'denied',
        entityId: 'owner-1',
        scope: 'user:owner-1',
        metadata: { reason: 'password_required' },
      }),
    );
  });

  it('spends the time a new account would cost before saying so', async () => {
    heldBy(owner());

    await handler.execute(command());

    expect(passwords.verifyDecoy).toHaveBeenCalledWith('secret123');
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('answers 409 for a Google or GitHub account, spends the same time, and tells the owner', async () => {
    heldBy(owner({ passwordHash: null }));

    const error = await handler.execute(command()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(passwords.verifyDecoy).toHaveBeenCalledWith('secret123');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'denied',
        scope: 'user:owner-1',
        metadata: { reason: 'social_only_account' },
      }),
    );
  });

  it('records a wrong password as a failure, not as a probe, and does not use the decoy', async () => {
    heldBy(owner());
    passwords.verify.mockResolvedValue(false);

    await expect(handler.execute(command('not-it'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(passwords.verifyDecoy).not.toHaveBeenCalled();
    expect(denied()).toHaveLength(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        metadata: { reason: 'wrong_password' },
      }),
    );
  });

  it('leaves no probe behind when the right password signs the owner in', async () => {
    heldBy(owner());
    passwords.verify.mockResolvedValue(true);

    const result = await handler.execute(command('stored-password'));

    expect(result).toMatchObject({ status: 'signed_in' });
    expect(passwords.verifyDecoy).not.toHaveBeenCalled();
    expect(denied()).toHaveLength(0);
  });

  it('records nothing for an address that is free', async () => {
    claims.find.mockResolvedValue({ kind: 'free' });

    const result = await handler.execute(command());

    expect(result).toEqual({ status: 'verification_required' });
    expect(passwords.verifyDecoy).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(verification.sendVerificationEmail).toHaveBeenCalledWith(
      { name: 'Jane Doe', email: 'jane@example.com' },
      'raw-token',
    );
  });
});
