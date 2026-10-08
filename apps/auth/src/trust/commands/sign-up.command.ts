// import dtos
import { SignUpDto } from '../dto/sign-up.dto.js';

export class SignUpCommand {
  constructor(public readonly dto: SignUpDto) {}
}
