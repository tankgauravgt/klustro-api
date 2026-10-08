import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private readonly saltRounds = 10;
  // A real hash at the real cost, to spend the same time when there is nothing to check against
  private readonly decoyHash = bcrypt.hashSync(randomUUID(), this.saltRounds);

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  // Always false; takes as long as `verify`, so a missing account cannot be told by response time
  async verifyDecoy(password: string): Promise<false> {
    await bcrypt.compare(password, this.decoyHash);
    return false;
  }

  verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
