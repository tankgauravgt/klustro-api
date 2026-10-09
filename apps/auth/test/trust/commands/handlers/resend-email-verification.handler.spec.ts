import { beforeEach } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';

// import commands
import { ResendEmailVerificationCommand } from '../../../../src/trust/commands/resend-email-verification.command.js';
import { ResendEmailVerificationHandler } from '../../../../src/trust/commands/handlers/resend-email-verification.handler.js';

describe('ResendEmailVerificationHandler', () => {
  const command = new ResendEmailVerificationCommand('user-1', 'email-1');
  const repository = { findOne: vi.fn() };
  const verification = { sendForAddress: vi.fn() };
  const handler = new ResendEmailVerificationHandler(
    repository as never,
    verification as never,
  );

  beforeEach(() => {
    repository.findOne.mockReset();
    verification.sendForAddress.mockReset().mockResolvedValue(undefined);
  });

  it('sends a new link for an unverified address on the account', async () => {
    const address = {
      id: 'email-1',
      userId: 'user-1',
      email: 'work@example.com',
      isVerified: false,
    };
    repository.findOne.mockResolvedValue(address);

    await handler.execute(command);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'email-1', userId: 'user-1' },
    });
    expect(verification.sendForAddress).toHaveBeenCalledWith('user-1', address);
  });

  it('sends nothing for an address that is already verified', async () => {
    repository.findOne.mockResolvedValue({ id: 'email-1', isVerified: true });

    await handler.execute(command);

    expect(verification.sendForAddress).not.toHaveBeenCalled();
  });

  it('answers the same way, sending nothing, for an address that is not on the account', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(handler.execute(command)).resolves.toBeUndefined();
    expect(verification.sendForAddress).not.toHaveBeenCalled();
  });

  it('lets a failure to send through, so the person is told', async () => {
    const broken = new Error('mailgun down');
    repository.findOne.mockResolvedValue({ id: 'email-1', isVerified: false });
    verification.sendForAddress.mockRejectedValue(broken);

    await expect(handler.execute(command)).rejects.toBe(broken);
  });
});
