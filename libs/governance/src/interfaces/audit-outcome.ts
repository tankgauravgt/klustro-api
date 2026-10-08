export const AUDIT_OUTCOMES = ['success', 'failure', 'denied'] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
