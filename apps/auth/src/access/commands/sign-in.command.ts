// import dtos
import { SignInDto } from '../dto/sign-in.dto.js';

export class SignInCommand {
  constructor(public readonly dto: SignInDto) {}
}
