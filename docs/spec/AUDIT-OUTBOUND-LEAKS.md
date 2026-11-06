# Audit canaux outbound — Veridian CRM

> Source de vérité du durcissement privacy du fork (ticket
> `todo/2026-05-27-P0-couper-leaks-outbound-twenty-labs.md`).
> Patches livrés le 2026-06-10. Tous les fichiers modifiés sont AGPL
> (vérifié `head -3`, aucun marker `@license Enterprise`).

## Principe

**Default OFF, fail-safe** : tous les canaux outbound non essentiels sont
désactivés par défaut dans le code du fork (pas seulement par ENV de deploy).
Un compose sans ENV particulière ne leake rien. Les flags existent pour
réactiver explicitement une feature si un jour on la veut.

## Tableau récapitulatif

| Domaine | Statut | Source (file:line) | Kill-switch | Donnée qui fuyait |
|---|---|---|---|---|
| twenty-telemetry.com | ✅ coupé (2026-05-27) | `engine/core-modules/telemetry/` | `TELEMETRY_ENABLED=false` (ENV prod Dokploy) | email + URL instance au signup (3 emails fuités avant coupure) |
| twenty-companies.com | ✅ coupé (2026-06-10) | `create-company.service.ts` (`getCompanyInfoFromDomainName`) | `COMPANIES_ENRICHMENT_ENABLED` (**default false**, code) | domaine de CHAQUE Company créée (57 domaines prospects fuités le 2026-05-27) |
| Sentry (PII) | ✅ neutralisé (2026-06-10) | `instrument.ts:38-46` | `sendDefaultPii: false`, `recordInputs/Outputs: false` en dur | dormant (SENTRY_DSN vide) ; si activé : IP+email sur chaque erreur + prompts AI |
| Sentry (AI spans) | ✅ neutralisé (2026-06-10) | `ai/ai-models/constants/ai-telemetry.const.ts` | `recordInputs/Outputs: false` en dur | prompts AI input+output |
| twenty-help-search.com / api-dsc.mintlify.com | ✅ coupé (2026-06-10) | `search-help-center-tool.ts` (`execute`) | `HELP_CENTER_SEARCH_ENABLED` (**default false**, code) | query texte en clair saisie par l'utilisateur |
| registry.npmjs.org (catalog sync, cron 1h) | ✅ coupé (2026-06-10) | `marketplace.service.ts` (`fetchAppsFromRegistry`) | `MARKETPLACE_REGISTRY_SYNC_ENABLED` (**default false**, code) | IP serveur + UA `Twenty-Marketplace` toutes les heures |
| registry.npmjs.org (version check, cron 6h) | ✅ coupé (2026-06-10) | `application-upgrade.service.ts` (`checkForUpdates`) | idem `MARKETPLACE_REGISTRY_SYNC_ENABLED` | IP serveur + UA `Twenty-AppUpgrade` (no-op tant que `applicationRegistration` vide) |
| unpkg.com (manifests/README CDN) | ✅ coupé (2026-06-10) | `marketplace.service.ts` (`fetchManifestFromRegistryCdn`, `fetchReadmeFromRegistryCdn`) | idem `MARKETPLACE_REGISTRY_SYNC_ENABLED` | IP serveur |
| models.dev (AI providers catalog) | ✅ coupé (2026-06-10) | `models-dev-catalog.service.ts` (`getCachedData`) | `AI_MODELS_CATALOG_FETCH_ENABLED` (**default false**, code) | IP serveur + UA à l'ouverture des settings AI |
| tradingview.com (iframe dashboard seed) | ✅ retiré (2026-06-10) | `compute-my-first-dashboard-widgets.util.ts` (widget supprimé du seed) | suppression (pas de flag) | IP + cookies + UA du navigateur de l'utilisateur. N'affecte que les NOUVEAUX workspaces — les dashboards existants sont persistés en DB |
| app.twenty.com/images (logo emails) | ✅ self-hosted (2026-06-10) | `twenty-emails/src/components/Logo.tsx` | asset servi par `crm.app.veridian.site` | IP de chaque destinataire d'email à l'ouverture (pixel tracking involontaire) |
| twenty.com (workflow demo prefill) | ✅ rebrandé (2026-06-10) | `prefill-workflows.util.ts:465,472` | valeurs → `veridian.site` | cosmétique (valeur par défaut d'un workflow démo) |
| twenty.com/api/enterprise/* | 💤 dormant (rien à faire) | `enterprise-plan.service.ts` (fichier EE, non modifié) | inactif sans `ENTERPRISE_KEY` (jamais posée chez Veridian) | — |
| hub.docker.com (admin panel version check) | 🟡 actif accepté | admin panel | — | IP serveur uniquement, GET catalog tags. P3, à couper si envie |
| e2b.dev (CodeInterpreter) | 💤 dormant | — | inactif sans `E2B_API_KEY` | si activé un jour : code + fichiers uploadés |

## Légitime conservé (ne pas couper)

OAuth Google/Microsoft (consentement user), Stripe (billing), SMTP Lark
(emails système), AWS SNS confirm (filtré regex), OTLP/Prometheus (opt-in
`METER_DRIVER`).

## Dette restante

- **Test e2e `no-outbound-leaks`** (nock disableNetConnect + allowlist) :
  spécifié dans le ticket, pas encore câblé — la CI fork ne lance que les
  tests unitaires ciblés + typecheck. La validation réelle du deploy =
  capture réseau sur le container prod (voir ci-dessous).
- Rebrand complet emails/footers (`Footer.tsx` href twenty.com — liens
  cliquables, pas des pixels) : passe rebrand séparée.
- Purge éventuelle des repeatable jobs BullMQ marketplace déjà enregistrés
  dans Redis : inutile fonctionnellement (le service est gated → no-op),
  mais le cron continue de se réveiller à vide.

## Vérification post-deploy (à rejouer après chaque deploy majeur)

```bash
# 0 paquet attendu pendant qu'on crée des Companies de test :
ssh prod-pub 'timeout 120 tcpdump -i any -nn "host twenty-companies.com or host twenty-telemetry.com" 2>/dev/null | head'
```

Test fonctionnel : créer 2-3 Companies via REST, vérifier qu'elles sont
créées avec le nom dérivé du domaine (pas d'enrichissement) et 0 paquet.
