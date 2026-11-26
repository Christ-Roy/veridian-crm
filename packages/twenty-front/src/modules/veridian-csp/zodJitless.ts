import { config } from 'zod';

// Veridian VER-265 (26/11/2026): the CSP forbids eval; without this, zod probes `new Function('')` on first parse
// and every page load reports a violation. Imported first in index.tsx, before any schema parses.
config({ jitless: true });
