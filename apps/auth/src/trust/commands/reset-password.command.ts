// import dtos
import { ResetPasswordDto } from '../dto/reset-password.dto.js';

export class ResetPasswordCommand {
  constructor(public readonly dto: ResetPasswordDto) {}
}
