# VERIDIAN-PATCHES.md : registre du fork

Base : `twenty/v2.56.1` (`60b63bd116`, 05/11/2026). Le fork est volontairement réduit à ce
tableau. Tout autre écart avec l'amont est une anomalie. Aucun fichier `/* @license Enterprise */`
n'y figure ; `scripts/ci/check-ee-integrity.sh` le prouve à chaque push.

## Patchs inline (fichiers AGPL ou MIT)

| Fichier | Patch | Pourquoi | Test qui casse s'il disparaît |
|---|---|---|---|
| `auth/constants/max-workspaces-without-organization-key.constant.ts` | `Number.MAX_SAFE_INTEGER` | lève la limite de 5 workspaces | `.veridian.spec.ts` voisin, `patch-survival.sh` |
| `twenty-shared/.../TwentyIconsBaseUrl.ts`, `getLogoUrlFromDomainName.ts`, `sign-in-up.service.ts` | URL vide, aucun logo déduit | domaines des sociétés et de l'email envoyés à twenty-icons.com, navigateur et serveur | `outbound-channels.veridian.spec.ts` |
| `twenty-shared/.../TwentyCompaniesBaseUrl.ts`, `create-company.service.ts` | URL vide, aucun appel | domaines des contacts importés envoyés à twenty-companies.com | `outbound-channels.veridian.spec.ts` |
| `compute-my-first-dashboard-widgets.util.ts` | iframe TradingView retirée | le navigateur de chaque utilisateur appelait tradingview.com | `outbound-channels.veridian.spec.ts` |
| `search-help-center-tool.ts` | coupé sauf `HELP_CENTER_SEARCH_ENABLED=true` | question de l'utilisateur envoyée à docs.twenty.com | `patch-survival.sh` |
| `core-modules/core-engine.module.ts` | importe `VeridianHubSsoModule` | Hub seule source d'identité | `patch-survival.sh` |
| `core-modules/auth/auth.module.ts` | exporte `SignInUpService` | provisioning par le Hub | `patch-survival.sh` |
| `.github/workflows/` | workflows amont supprimés, un seul `veridian-crm-ci.yaml` | loi 7, aucun runner hébergé | à revérifier à chaque sync |

## Code neuf

`core-modules/veridian-hub-sso/`, le Hub seule source d'identité (décision Robert, 06/11/2026) :

| Route | Rôle | Contrat |
|---|---|---|
| `POST /api/sso/issue-magic-link`, `GET /auth/token?t=` | rebond ; `hub_user_id` d'abord, email pour rattacher un compte sans lien | §6bis.8 |
| `POST /api/tenants/provision` | crée utilisateur et workspace | §5.1 |
| `POST /api/tenants/:id/sync-member`, `POST /api/veridian/workspaces/:id/attach-member` | ajoute un membre | §5.18.3, §5.22.2 |
| `POST /api/tenants/:id/remove-member` | retire un membre, données conservées | §5.19.2 |
| `POST /api/hub/users/sync`, `GET /api/hub/users` | copie nom, email et suppression ; liste pour l'audit | §3.8 |
| `GET /api/users/by-email` | workspaces d'une adresse | §5.12 |
| `GET /welcome` | renvoie vers `HUB_LOGIN_URL` | §6bis.8.1 |

`HubOnlyIdentityGuard` refuse inscription, connexion par mot de passe, invitations, changement d'email ou de
nom. Le lien porte un login token Twenty : 15 min, à usage unique, consommé par `/verify`. Liens Hub dans
`core.keyValuePair`, aucune table neuve. Variables : `HUB_API_SECRET`, `HUB_API_SECRET_NEXT`, `HUB_LOGIN_URL`,
`HUB_SERVER_ADMIN_EMAILS`. Sans secret, les routes répondent 503.

Hors du lot, arbitré par le Hub le 06/11/2026 : `update-plan`, `suspend`, `resume`, `health`, `DELETE`, et toute clé API au provisioning (§3.8 : les clés machine restent locales).

## Coupé par variable d'environnement (job Nomad, aucun patch)

| Canal mesuré | Variable |
|---|---|
| twenty-telemetry.com, au signup | `TELEMETRY_ENABLED=false` |
| registry.npmjs.org et unpkg.com, au démarrage | `MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false` |
| connexion par mot de passe | `AUTH_PASSWORD_ENABLED=false` |

## Inerts sans configuration, laissés tels quels

Sentry (`SENTRY_DSN`), support (`SUPPORT_DRIVER`), PeopleDataLabs (`PEOPLE_DATA_LABS_API_KEY`),
clé Enterprise (`ENTERPRISE_KEY`), fournisseurs IA (clés). models.dev : lecture d'un catalogue public,
uniquement depuis le panneau d'administration IA.

## Retiré ou reporté lors du retour à v2.56.1

Le code reste dans le premier parent du commit de bascule (`git log --first-parent`).

| Ancien module | Décision | Raison mesurée |
|---|---|---|
| `veridian-sso` (OIDC, SAML) | retiré | tables absentes de la base archivée, 0 fournisseur, remplacé par le rebond |
| `veridian-audit-log` | retiré | table absente de la base archivée |
| décorateur `isUIReadOnly`, `prefill-workflows` | retiré | contournement 2.13, cosmétique |
| `veridian-record-open`, `veridian-prospection-filters`, `veridian-prospect-card` | reporté | liés aux champs du workspace Veridian archivé, décision de migration à prendre |
| `veridian-tunnel-timeline`, filtre de bruit du pont | reporté | l'émetteur n'écrit plus |
| `veridian-custom-domain`, logo des emails | reporté | sans usage mesuré ; rebrand à trancher avant toute prod |

## Sync amont

1. `git merge <tag>` ; conflits attendus limités au tableau ci-dessus.
2. Supprimer les workflows amont réapparus dans `.github/workflows/`.
3. Bumper `FORK_MARKER` dans `check-ee-integrity.sh`, puis le lancer.
4. `scripts/ci/patch-survival.sh`.
5. `scripts/ci/capture-sortante.sh` sur le staging pendant un parcours : tout nouveau canal sort en code 1.
