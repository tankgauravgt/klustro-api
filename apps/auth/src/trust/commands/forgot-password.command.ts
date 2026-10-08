// import dtos
import { ForgotPasswordDto } from '../dto/forgot-password.dto.js';

export class ForgotPasswordCommand {
  constructor(public readonly dto: ForgotPasswordDto) {}
}
