// `verification_required`: account created but unusable until its email is verified (no token).
// `password_required`: the email belongs to a verified account; resend with its password to sign in.
export type SignUpResult =
  | { status: 'signed_in'; accessToken: string; requiresPasswordSetup: boolean }
  | { status: 'verification_required' }
  | { status: 'password_required' };
