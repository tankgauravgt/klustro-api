import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

// import services
import { EmailVerificationService } from '../../../src/trust/services/email-verification.service.js';
import { hashVerificationToken } from '../../../src/trust/services/email-verification.service.js';

// import models
import { EmailVerificationToken } from '../../../src/trust/models/email-verification-token.entity.js';

describe('EmailVerificationService', () => {
  const config = { get: vi.fn(() => 'https://app.test') };
  const mail = { send: vi.fn() };
  const tokenRepository = {
    update: vi.fn(),
    save: vi.fn(),
    create: vi.fn((value: object) => value),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === EmailVerificationToken ? tokenRepository : undefined,
  };
  const tokens = { manager };
  const users = { findOneBy: vi.fn() };
  const service = new EmailVerificationService(
    config as never,
    mail as never,
    tokens as never,
    users as never,
  );

  beforeEach(() => {
    tokenRepository.update.mockReset().mockResolvedValue({ affected: 0 });
    tokenRepository.save.mockReset();
    mail.send.mockReset().mockResolvedValue(undefined);
    users.findOneBy
      .mockReset()
      .mockResolvedValue({ firstName: 'Jane', lastName: 'Doe' });
  });

  const savedToken = () =>
    tokenRepository.save.mock.calls[0][0] as {
      userId: string;
      emailId: string | null;
      tokenHash: string;
      used: boolean;
    };

  describe('issue', () => {
    it('ties a sign-up link to the account alone and leaves other links open', async () => {
      const raw = await service.issue(manager as never, 'user-1');

      expect(savedToken()).toMatchObject({
        userId: 'user-1',
        emailId: null,
        used: false,
        tokenHash: hashVerificationToken(raw),
      });
      expect(raw).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenRepository.update).not.toHaveBeenCalled();
    });

    it('ties a link to the address and closes the links still open for it', async () => {
      const raw = await service.issue(manager as never, 'user-1', 'email-2');

      expect(tokenRepository.update).toHaveBeenCalledWith(
        { emailId: 'email-2', used: false },
        { used: true },
      );
      expect(savedToken()).toMatchObject({
        emailId: 'email-2',
        tokenHash: hashVerificationToken(raw),
      });
    });
  });

  describe('sendForAddress', () => {
    it('mails the new address a link carrying the issued token', async () => {
      await service.sendForAddress('user-1', {
        id: 'email-2',
        email: 'work@example.com',
      });

      expect(mail.send).toHaveBeenCalledTimes(1);
      const message = mail.send.mock.calls[0][0] as {
        to: { name: string; email: string };
        subject: string;
        text: string;
      };
      expect(message.to).toEqual({
        name: 'Jane Doe',
        email: 'work@example.com',
      });
      expect(message.subject).toBe('Confirm your email address for Klustro');
      expect(message.text).toContain('Hi Jane,');
      const raw = /verify-email\?token=([0-9a-f]{64})/.exec(message.text)?.[1];
      expect(raw).toBeDefined();
      expect(savedToken().tokenHash).toBe(hashVerificationToken(raw!));
      expect(savedToken().emailId).toBe('email-2');
      expect(message.text).toContain('https://app.test/verify-email?token=');
    });

    it('still mails when the account has no name', async () => {
      users.findOneBy.mockResolvedValue({ firstName: null, lastName: null });

      await service.sendForAddress('user-1', {
        id: 'email-2',
        email: 'work@example.com',
      });

      const message = mail.send.mock.calls[0][0] as {
        to: { name: string };
        text: string;
      };
      expect(message.to.name).toBe('');
      expect(message.text).toContain('Hi there,');
    });
  });
});
