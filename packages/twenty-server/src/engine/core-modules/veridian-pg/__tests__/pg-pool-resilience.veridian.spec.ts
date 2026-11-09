import { createServer, type Server, type Socket } from 'net';

import { Pool } from 'pg';

import { getVeridianPgPoolResilience } from 'src/engine/core-modules/veridian-pg/pg-pool-resilience.util';

const message = (type: string, body: Buffer) => {
  const header = Buffer.alloc(5);

  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);

  return Buffer.concat([header, body]);
};

const readyForQuery = () => message('Z', Buffer.from('I'));

const selectOneResult = () => {
  const field = Buffer.alloc(16);

  field.writeInt16BE(1, 0);
  field.write('x\0', 2);
  field.writeInt32BE(0, 4);
  field.writeInt16BE(0, 8);
  field.writeInt32BE(23, 10);
  field.writeInt16BE(4, 14);

  const row = Buffer.alloc(7);

  row.writeInt16BE(1, 0);
  row.writeInt32BE(1, 2);
  row.write('1', 6);

  return Buffer.concat([
    message(
      'T',
      Buffer.concat([field, Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0])]),
    ),
    message('D', row),
    message('C', Buffer.from('SELECT 1\0')),
    readyForQuery(),
  ]);
};

// Minimal Postgres wire server: trusts every login, then the first connections never answer a query.
const startFakePostgres = async ({
  silentConnections,
}: {
  silentConnections: number;
}) => {
  const openSockets: Socket[] = [];
  let connections = 0;
  const fake = createServer((socket) => {
    const isSilent = connections < silentConnections;
    let isStarted = false;

    connections += 1;
    openSockets.push(socket);
    socket.on('error', () => undefined);
    socket.on('data', (data) => {
      if (!isStarted) {
        isStarted = true;
        socket.write(
          Buffer.concat([
            message('R', Buffer.from([0, 0, 0, 0])),
            readyForQuery(),
          ]),
        );

        return;
      }

      if (data.toString('latin1', 0, 1) === 'Q' && !isSilent) {
        socket.write(selectOneResult());
      }
    });
  });

  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));

  return {
    port: (fake.address() as { port: number }).port,
    connectionCount: () => connections,
    stop: async () => {
      openSockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => fake.close(resolve));
    },
  };
};

const raceAgainst3s = (query: Promise<unknown>) =>
  Promise.race([
    query.then(
      () => 'answered',
      (error: Error) => error.message,
    ),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('still waiting after 3 s'), 3000),
    ),
  ]);

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

  it('drops a connection whose primary went silent and heals on the next query', async () => {
    const fakePostgres = await startFakePostgres({ silentConnections: 1 });
    const pool = new Pool({
      ...getVeridianPgPoolResilience(),
      connectionString: `postgres://twenty:x@127.0.0.1:${fakePostgres.port}/twenty`,
      query_timeout: 300,
      max: 1,
    });

    const firstAnswer = await raceAgainst3s(pool.query('select 1'));
    const secondAnswer = await raceAgainst3s(pool.query('select 1'));

    expect(firstAnswer).toMatch(/timeout/i);
    expect(secondAnswer).toBe('answered');
    expect(fakePostgres.connectionCount()).toBe(2);

    await pool.end();
    await fakePostgres.stop();
  }, 10000);

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
