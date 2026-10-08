import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';

// import application libraries
import { resolveAddress } from '@libs/common';
import { unpublishAddress } from '@libs/common';
import type { ServiceName } from '@libs/common';

const SERVICES: { name: ServiceName; entry: string }[] = [
  { name: 'auth', entry: 'apps/auth/src/main.ts' },
  { name: 'projects', entry: 'apps/projects/src/main.ts' },
];
const STOP_TIMEOUT_MS = 5_000;
const READY_TIMEOUT_MS = 30_000;

// Starts the services as child processes of the gateway, so they can be restarted from here
@Injectable()
export class ServiceSupervisor {
  private readonly logger = new Logger('ServiceSupervisor');
  private readonly children = new Map<ServiceName, ChildProcess>();

  startAll(): void {
    for (const service of SERVICES) {
      this.spawn(service);
    }

    const stopAll = () => {
      for (const child of this.children.values()) {
        child.kill('SIGTERM');
      }
    };
    process.once('exit', stopAll);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        stopAll();
        process.exit(0);
      });
    }
  }

  // Stops every service and starts it again; resolves once each one has published its address
  async restartAll(): Promise<ServiceName[]> {
    await Promise.all(SERVICES.map((service) => this.stop(service.name)));
    for (const service of SERVICES) {
      this.spawn(service);
    }
    await Promise.all(SERVICES.map((service) => this.waitUntilReady(service.name)));
    return SERVICES.map((service) => service.name);
  }

  private spawn({ name, entry }: { name: ServiceName; entry: string }): void {
    const child = spawn(
      process.execPath,
      ['--import', '@swc-node/register/esm-register', entry],
      { stdio: 'inherit' },
    );
    child.on('exit', (code, signal) => {
      this.logger.warn(`${name} exited (${code ?? signal})`);
    });
    this.children.set(name, child);
  }

  private async stop(name: ServiceName): Promise<void> {
    unpublishAddress(name);
    const child = this.children.get(name);
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
    await exited;
    clearTimeout(force);
  }

  private async waitUntilReady(name: ServiceName): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!resolveAddress(name)) {
      if (Date.now() > deadline) {
        throw new Error(`${name} did not start within ${READY_TIMEOUT_MS} ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
