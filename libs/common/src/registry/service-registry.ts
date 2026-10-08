import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ServiceName = 'auth' | 'projects';

// Shared by every service on this machine, so each one can find the others' current address
const REGISTRY_DIR = join(tmpdir(), 'klustro-services');

export function publishAddress(name: ServiceName, url: string): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(join(REGISTRY_DIR, `${name}.json`), JSON.stringify({ url }));
}

export function unpublishAddress(name: ServiceName): void {
  rmSync(join(REGISTRY_DIR, `${name}.json`), { force: true });
}

// The address last published by the service, or undefined when it has not started
export function resolveAddress(name: ServiceName): string | undefined {
  try {
    const { url } = JSON.parse(
      readFileSync(join(REGISTRY_DIR, `${name}.json`), 'utf8'),
    ) as { url: string };
    return url;
  } catch {
    return undefined;
  }
}
