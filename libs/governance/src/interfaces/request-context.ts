export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  actorId?: string;
  operation?: string;
}
