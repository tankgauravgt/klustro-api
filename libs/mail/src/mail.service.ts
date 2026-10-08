import { Injectable } from '@nestjs/common';

// import application libraries
import { AppConfigService } from '@libs/common';
import { OUTBOUND_REQUEST_TIMEOUT_MS } from '@libs/common';

// import interfaces
import type { MailMessage } from './interfaces/mail-message.js';
import type { MailRecipient } from './interfaces/mail-message.js';

const SENDING_DOMAIN = 'klustro.tankgauravgt.me';
const SENDER = 'Klustro <hello@klustro.tankgauravgt.me>';

@Injectable()
export class MailService {
  constructor(private readonly config: AppConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const form = new FormData();
    form.append('from', SENDER);
    form.append('to', formatRecipient(message.to));
    form.append('subject', message.subject);
    form.append('text', message.text);

    const apiKey = this.config.get('MAILGUN_SENDING_API_KEY');
    const response = await fetch(
      `${mailgunOrigin(this.config.get('MAILGUN_BASEURL'))}/v3/${SENDING_DOMAIN}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        },
        body: form,
        signal: AbortSignal.timeout(OUTBOUND_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Mailgun refused the message: HTTP ${response.status}`);
    }
  }
}

// Accepts the host ("api.mailgun.net") or a full origin ("https://api.mailgun.net")
function mailgunOrigin(baseUrl: string): string {
  return `https://${baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
}

// Quotes the display name; quotes, backslashes and line breaks are dropped so it cannot end the quoting
function formatRecipient({ name, email }: MailRecipient): string {
  const safeName = name.replace(/["\\\r\n]/g, '').trim();
  return safeName ? `"${safeName}" <${email}>` : email;
}
