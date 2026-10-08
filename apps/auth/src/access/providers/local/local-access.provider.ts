import { Injectable } from '@nestjs/common';

// import features
import type { AccessProvider } from '../../interfaces/access-provider.js';

// Username/email + password. It is listed with the other providers; its endpoints are in the controller.
@Injectable()
export class LocalAccessProvider implements AccessProvider {
  readonly name = 'local' as const;
  readonly kind = 'credentials' as const;
}
