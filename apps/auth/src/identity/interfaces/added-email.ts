// What adding an email answers; the same fields, and nothing else, whether or not it was added
export interface AddedEmail {
  id: string;
  email: string;
  isPrimary: false;
  isVerified: false;
  providedBy: null;
}
