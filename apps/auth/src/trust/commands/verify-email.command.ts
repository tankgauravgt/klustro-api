// import dtos
import { VerifyEmailDto } from '../dto/verify-email.dto.js';

export class VerifyEmailCommand {
  constructor(public readonly dto: VerifyEmailDto) {}
}
