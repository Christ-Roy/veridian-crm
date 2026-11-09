import { ServiceUnavailableException } from '@nestjs/common';

import { DatabaseHealthController } from 'src/engine/core-modules/veridian-pg/controllers/database-health.controller';

const controllerWith = (query: () => Promise<unknown>) =>
  new DatabaseHealthController({ query } as never);

describe('/healthz/base (pg-saas failover, 09/11/2026)', () => {
  it('answers ok when the database answers', async () => {
    await expect(
      controllerWith(async () => [{ '?column?': 1 }]).check(),
    ).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('answers 503 when the database refuses', async () => {
    await expect(
      controllerWith(async () => {
        throw new Error('the database system is shutting down');
      }).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('answers 503 within 2 s when the database stays silent', async () => {
    jest.useFakeTimers();

    const result = controllerWith(() => new Promise(() => undefined)).check();
    const assertion = expect(result).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});
