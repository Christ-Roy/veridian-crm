// Veridian (26/11/2026, chasse transverse) : l'amont répond « Access-Control-Allow-Origin: * » (avec credentials) à toute
// origine hors liste. Le navigateur n'y joint aucun cookie, mais rien de Veridian n'appelle le CRM depuis une autre
// origine (front servi sur l'hôte de son espace, appels du Hub côté serveur, mesuré dans les journaux sur 7 jours).
// VERIDIAN_CORS_STRICT=true : une origine hors liste ne reçoit plus aucun en-tête CORS.
export const isVeridianStrictCors = (): boolean =>
  process.env.VERIDIAN_CORS_STRICT === 'true';
