/*
 * Mailgun is replaced in the e2e run: the messages sent to MAILGUN_BASEURL are recorded here
 * instead of being delivered. Every other request goes to the network as usual.
 */
export interface CapturedMail {
  to: string;
  subject: string;
  text: string;
}

export const sentMail: CapturedMail[] = [];

// The token in the link to `path` (e.g. '/reset-password') in the most recent message
export function tokenFromLatestMail(path: string): string {
  const mail = sentMail.at(-1);
  const match = mail && new RegExp(`${path}\\?token=([0-9a-f]{64})`).exec(mail.text);
  if (!match) {
    throw new Error(`No ${path} link in the latest mail`);
  }
  return match[1];
}

const MAILGUN_HOST = 'https://mailgun.test/';
const realFetch = globalThis.fetch;

globalThis.fetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(MAILGUN_HOST)) {
    return realFetch(input, init);
  }
  const form = init?.body as FormData;
  sentMail.push({
    to: String(form.get('to')),
    subject: String(form.get('subject')),
    text: String(form.get('text')),
  });
  return new Response(JSON.stringify({ message: 'Queued. Thank you.' }), {
    status: 200,
  });
}) as typeof fetch;
