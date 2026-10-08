import { afterAll } from 'vitest';
import { beforeAll } from 'vitest';
import { describe } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

// import applications
import { AppGwModule } from '@apps/app-gw';

// import services
import { ServiceSupervisor } from '../../src/service-supervisor.js';

describe('POST /wipe-db (e2e)', () => {
  let app: INestApplication;
  const restartAll = vi.fn(async () => ['auth', 'projects']);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppGwModule],
    })
      .overrideProvider(ServiceSupervisor)
      .useValue({ restartAll, startAll: vi.fn() })
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('restarts every service and reports which ones came back', async () => {
    const res = await request(app.getHttpServer()).post('/wipe-db');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restarted: ['auth', 'projects'] });
    expect(restartAll).toHaveBeenCalledTimes(1);
  });
});
