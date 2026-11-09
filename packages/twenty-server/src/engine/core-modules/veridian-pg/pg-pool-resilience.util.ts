// pg-saas fails over behind a TCP entry that accepts connections while no primary answers:
// with pg's default connectionTimeoutMillis (0) a request then waits forever (09/11/2026).
// Bounded connect, TCP keepalive and a maximum lifetime let the pool heal by itself.
export const getVeridianPgPoolResilience = () => ({
  connectionTimeoutMillis: Number(
    process.env.PG_POOL_CONNECTION_TIMEOUT_MS ?? 10000,
  ),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  maxLifetimeSeconds: Number(process.env.PG_POOL_MAX_LIFETIME_S ?? 1800),
});
