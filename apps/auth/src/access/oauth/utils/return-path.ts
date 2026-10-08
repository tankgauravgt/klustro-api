// Only a path on the web app is a safe place to send someone afterwards (no `//host`, no `\`)
export function safeReturnPath(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  return value.includes('\\') ? undefined : value;
}
