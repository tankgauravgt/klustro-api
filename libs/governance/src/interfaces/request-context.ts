export interface RequestContext {
  requestId: string;
  ip?: string;
  // The address of the connection itself, i.e. the last proxy; and the unverified X-Forwarded-For chain
  peerIp?: string;
  forwardedFor?: string;
  userAgent?: string;
  actorId?: string;
  operation?: string;
}
