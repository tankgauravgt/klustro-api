// What any member may see of the audit trail: what happened and who did it, nothing else
export interface ActivityEntry {
  sequence: number;
  occurredAt: string;
  action: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface ActivityPage {
  items: ActivityEntry[];
  nextBefore: number | null;
}

export interface AuditVerification {
  valid: boolean;
}
