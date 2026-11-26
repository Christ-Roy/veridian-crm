// Veridian VER-265 (26/11/2026): the worker realm inherits the CRM CSP, which forbids eval. zod reads its config from
// globalThis.__zod_globalConfig; set here, with no import, so it runs before zod evaluates (first import of remote-worker).
const zodGlobal = globalThis as { __zod_globalConfig?: Record<string, unknown> };

zodGlobal.__zod_globalConfig = { ...zodGlobal.__zod_globalConfig, jitless: true };

export {};
