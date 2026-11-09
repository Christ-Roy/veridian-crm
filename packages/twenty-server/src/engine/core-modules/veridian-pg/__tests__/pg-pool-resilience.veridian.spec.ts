import { createServer, type Server, type Socket } from 'net';

import { Pool } from 'pg';

import { getVeridianPgPoolResilience } from 'src/engine/core-modules/veridian-pg/pg-pool-resilience.util';

// Reproduces a pg-saas failover: the TCP entry accepts the connection, no Postgres answers.
describe('pg pool resilience (pg-saas failover, 09/11/2026)', () => {
  let server: Server;
  let port: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    jest.useRealTimers();
    server = createServer((socket) => {
      sockets.push(socket);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => server.close(resolve));
  });

  afterEach(() => {
    delete process.env.PG_POOL_CONNECTION_TIMEOUT_MS;
    delete process.env.PG_POOL_MAX_LIFETIME_S;
  });

  it('fails fast instead of waiting forever on a silent entry', async () => {
    process.env.PG_POOL_CONNECTION_TIMEOUT_MS = '300';

    const pool = new Pool({
      ...getVeridianPgPoolResilience(),
      connectionString: `postgres://twenty:x@127.0.0.1:${port}/twenty`,
    });
    const outcome = await Promise.race([
      pool.query('select 1').then(
        () => 'answered',
        (error: Error) => error.message,
      ),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('still waiting after 3 s'), 3000),
      ),
    ]);

    expect(outcome).toMatch(/timeout/i);

    sockets.forEach((socket) => socket.destroy());
    await pool.end();
  }, 5000);

  it('keeps TCP keepalive on and recycles connections', () => {
    expect(getVeridianPgPoolResilience()).toEqual({
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      maxLifetimeSeconds: 1800,
    });

    process.env.PG_POOL_MAX_LIFETIME_S = '600';

    expect(getVeridianPgPoolResilience().maxLifetimeSeconds).toBe(600);
  });
});
