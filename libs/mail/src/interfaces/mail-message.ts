export interface MailRecipient {
  name: string;
  email: string;
}

export interface MailMessage {
  to: MailRecipient;
  subject: string;
  text: string;
}
