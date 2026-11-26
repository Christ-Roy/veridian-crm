import { applyCredentialedCors } from 'src/engine/core-modules/user-session/utils/apply-credentialed-cors.util';

// Veridian (26/11/2026) : avec VERIDIAN_CORS_STRICT=true, une origine hors liste ne reçoit plus « * » ; l'origine du
// CRM reste reflétée avec ses cookies. Sans la variable, le comportement amont est intact (témoin).
type OriginCallback = (error: Error | null, allow?: boolean | string) => void;

const origineDecidee = (origine: string | undefined): boolean | string | undefined => {
  let options: { origin: (o: string | undefined, cb: OriginCallback) => void } | undefined;
  const app = {
    use: () => undefined,
    enableCors: (o: typeof options) => {
      options = o;
    },
  };
  const config = {
    get: (cle: string) =>
      ({
        SERVER_URL: 'https://crm.app.veridian.site',
        FRONTEND_URL: 'https://crm.app.veridian.site',
        AUTH_COOKIE_ALLOWED_ORIGINS: '',
        NODE_ENV: 'production',
      })[cle],
  };

  applyCredentialedCors(app as never, config as never);
  let decision: boolean | string | undefined;

  options?.origin(origine, (_erreur, autorise) => {
    decision = autorise;
  });

  return decision;
};

describe('Veridian : CORS resserré', () => {
  const avant = process.env.VERIDIAN_CORS_STRICT;

  afterEach(() => {
    process.env.VERIDIAN_CORS_STRICT = avant;
  });

  it("refuse toute origine hors liste quand l'interrupteur est posé", () => {
    process.env.VERIDIAN_CORS_STRICT = 'true';

    expect(origineDecidee('https://evil.example')).toBe(false);
    expect(origineDecidee('https://hub.app.veridian.site')).toBe(false);
    expect(origineDecidee(undefined)).toBe(false);
  });

  it("garde l'origine du CRM, avec ses cookies", () => {
    process.env.VERIDIAN_CORS_STRICT = 'true';

    expect(origineDecidee('https://crm.app.veridian.site')).toBe(true);
  });

  it("laisse le comportement amont sans l'interrupteur (témoin)", () => {
    delete process.env.VERIDIAN_CORS_STRICT;

    expect(origineDecidee('https://evil.example')).toBe('*');
  });
});
