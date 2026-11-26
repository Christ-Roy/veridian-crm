import { config } from 'zod';

// Veridian VER-265 (26/11/2026): the worker realm inherits the CRM CSP, which forbids eval; without this, zod probes
// `new Function('')` and every panel opening reports a violation. Imported first in remote-worker.ts.
config({ jitless: true });
