import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

// import commands
import { VerifyEmailCommand } from '../../../../src/trust/commands/verify-email.command.js';
import { VerifyEmailHandler } from '../../../../src/trust/commands/handlers/verify-email.handler.js';

// import models
import { Email } from '../../../../src/identity/models/email.entity.js';
import { User } from '../../../../src/identity/models/user.entity.js';
import { EmailVerificationToken } from '../../../../src/trust/models/email-verification-token.entity.js';

describe('VerifyEmailHandler', () => {
  const command = new VerifyEmailCommand({ token: 'a'.repeat(64) });
  const tokens = { findOne: vi.fn(), update: vi.fn() };
  const users = { findOne: vi.fn(), save: vi.fn() };
  const emails = { findOne: vi.fn(), save: vi.fn() };
  const audit = { record: vi.fn() };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === EmailVerificationToken
        ? tokens
        : entity === User
          ? users
          : entity === Email
            ? emails
            : undefined,
  };
  const dataSource = {
    transaction: async (work: (m: unknown) => Promise<void>) => work(manager),
  };
  const handler = new VerifyEmailHandler(dataSource as never, audit as never);

  let user: { id: string; isEmailVerified: boolean };

  beforeEach(() => {
    user = { id: 'user-1', isEmailVerified: false };
    tokens.findOne.mockReset();
    tokens.update.mockReset().mockResolvedValue({ affected: 1 });
    users.findOne.mockReset().mockImplementation(async () => user);
    users.save.mockReset();
    emails.findOne.mockReset();
    emails.save.mockReset();
    audit.record.mockReset();
  });

  describe('for a sign-up link', () => {
    beforeEach(() => {
      tokens.findOne.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        emailId: null,
      });
    });

    it('activates the account and verifies its primary address', async () => {
      const primary = { id: 'email-0', isPrimary: true, isVerified: false };
      emails.findOne.mockResolvedValue(primary);

      await handler.execute(command);

      expect(user.isEmailVerified).toBe(true);
      expect(primary.isVerified).toBe(true);
      expect(emails.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', isPrimary: true },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.email.verified',
          entityType: 'user',
        }),
        manager,
      );
    });
  });

  describe('for a link to an added address', () => {
    beforeEach(() => {
      tokens.findOne.mockResolvedValue({
        id: 'token-2',
        userId: 'user-1',
        emailId: 'email-2',
      });
    });

    it('verifies that address and leaves the account as it was', async () => {
      const added = { id: 'email-2', isPrimary: false, isVerified: false };
      emails.findOne.mockResolvedValue(added);

      await handler.execute(command);

      expect(emails.findOne).toHaveBeenCalledWith({
        where: { id: 'email-2', userId: 'user-1' },
      });
      expect(added.isVerified).toBe(true);
      expect(user.isEmailVerified).toBe(false);
      expect(users.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.email.verified',
          entityType: 'email',
          entityId: 'email-2',
          scope: 'user:user-1',
        }),
        manager,
      );
    });

    it('marks the account verified when the address is its primary one', async () => {
      emails.findOne.mockResolvedValue({
        id: 'email-2',
        isPrimary: true,
        isVerified: false,
      });

      await handler.execute(command);

      expect(user.isEmailVerified).toBe(true);
      expect(users.save).toHaveBeenCalledWith(user);
    });

    it('refuses the link once the address has been removed', async () => {
      emails.findOne.mockResolvedValue(null);

      await expect(handler.execute(command)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(emails.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it('refuses a link that is unknown, used or expired', async () => {
    tokens.findOne.mockResolvedValue(null);

    await expect(handler.execute(command)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a link another request used first', async () => {
    tokens.findOne.mockResolvedValue({ id: 'token-1', userId: 'user-1' });
    tokens.update.mockResolvedValue({ affected: 0 });

    await expect(handler.execute(command)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
