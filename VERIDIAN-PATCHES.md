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
| `twenty-front/src/pages/auth/SignInUp.tsx` | `useRedirectToHubLogin()` | sans session, renvoi vers le Hub, navigation interne comprise | `patch-survival.sh` |
| `twenty-front/src/modules/auth/hooks/useAuth.ts` | déconnexion vers `/welcome?logout=1` | clic explicite : pose le cookie local, pas de reconnexion silencieuse (§6bis.8.0) | `patch-survival.sh` |
| `DefaultWorkspaceLogo.ts`, `OnboardingNetworkPreviewPeople.ts` (`twenty-front`) | image embarquée, avatar vide | le navigateur appelait twentyhq.github.io | `patch-survival.sh` |
| `domain-manager/hooks/useRedirect.ts` (`twenty-front`) | ne relance pas la navigation en cours | boucle sur le domaine nu : 607 navigations en 25 s, le rebond n'aboutissait jamais | `patch-survival.sh`, parcours |
| `MultiWorkspaceDropdownDefaultComponents.tsx`, `SettingsWorkspaceMembers.tsx`, `SettingsProfile.tsx`, `SettingsGeneral.tsx`, `MemberInfosTab.tsx`, `MemberNameFields.tsx`, `SettingsSecurityAuthProvidersOptionsList.tsx` (`twenty-front`) | retirés : Create Workspace, Invite user, onglet Invite, Delete account, Delete workspace, Invite by Link, 2FA locale (profil, bascule, récupération) ; nom d'un membre en lecture seule | ces actions appartiennent au Hub, le serveur les refuse déjà | `patch-survival.sh` |
| `getting-started/services/getting-started.service.ts` | étape INVITE_TEAM filtrée | pas d'invitation interne | `patch-survival.sh` |
| `twenty-server/package.json`, `yarn.lock` | `@modelcontextprotocol/sdk` 1.32.0 (amont 1.30.0) | 4 HIGH corrigées, à retirer dès que l'amont suit | trivy sur l'image |
| `utils/i18n/dynamicActivate.ts` + `veridian-brand/replaceBrandInMessages.ts` (`twenty-front`) | « Twenty » devient « Veridian CRM » au chargement du catalogue, toutes langues, `.po` intacts | `.github/TRADEMARK.md` : un fork exploité porte son nom | `marque.veridian.spec.ts`, parcours |
| `timeline-activities/utils/getTimelineActivityAuthorFullName.ts` + `veridian-brand/getVeridianSystemAuthorFullName.ts` (`twenty-front`) | auteur d'une activité sans membre : « Veridian CRM » au lieu du littéral « Twenty », aucun pour les lignes d'appel et de SMS de l'app Téléphonie | littéral hors catalogue, la marque fuyait sur chaque ligne système ; « Appel Entrant · 3 min » se lit seul | `patch-survival.sh`, test amont adapté |
| `index.html`, `public/manifest.json`, `public/images/` (`scripts/ci/marque.sh`), `title-utils.ts` (`twenty-front`) | nom et icône du Hub, images à nom identique, images sociales distantes retirées | idem, et plus d'appel à raw.githubusercontent.com | `patch-survival.sh`, parcours |
| `SettingsNavigationDrawerContent.tsx` (`twenty-front`) | mention « Basé sur Twenty, AGPL » et lien vers le code | AGPL | `patch-survival.sh`, parcours |
| `build-is-permission-flag-granted.util.ts`, `is-permission-flag-granted-to-flat-role.util.ts` + `veridian-ai/` | drapeau `AI` refusé à tout rôle si `VERIDIAN_AI_DISABLED=true` | aucun fournisseur IA (Robert) : chat, agents, compétences, actions IA disparaissent et sont refusés côté serveur, MCP reste | `ia-coupee.veridian.spec.ts`, `patch-survival.sh`, parcours |
| `getSettingsAiTabs.ts`, `SettingsAI.tsx`, `SidePanelWorkflowSelectAction.tsx`, `buildMcpSetupCategories.tsx` (`twenty-front`) | sans le drapeau `AI` : onglet MCP seul, pas de section IA ni Agents dans les workflows ; carte ChatGPT pointée sur les connecteurs de ChatGPT (URL MCP de l'espace) au lieu de l'app du cloud Twenty | pas de menu mort ; la carte d'origine ouvrait l'app ChatGPT du cloud Twenty | `patch-survival.sh`, parcours |
| `filterAndSortNavigationMenuItems.ts`, `useNavigationMenuItemsByFolder.ts`, `useIsLogConsoleAllowed.ts`, `SidePanelWorkflowSelectAction.tsx` (`twenty-front`) | Campaigns et Listes retirés du menu (et leur dossier vidé), console Logs sans ClickHouse masquée, action Code absente | pas de menu mort : envoi de Twenty sur `LOG` (Notifuse fait foi), logs dans ClickHouse que nous n'avons pas, code client jamais exécuté | `patch-survival.sh`, parcours |
| `workflow-version-step-operations.workspace-service.ts` + `veridian-coupures/` | étapes Code, fonction et IA refusées à la création quand elles ne peuvent pas s'exécuter | pas d'exécution de code client en multi-client (parente, 08/11/2026) | `actions-coupees.veridian.spec.ts`, `patch-survival.sh` |
| `.github/workflows/` | workflows amont supprimés, un seul `veridian-crm-ci.yaml` | loi 7, aucun runner hébergé | à revérifier à chaque sync |

## Code neuf

`packages/twenty-apps/internal/veridian-telephonie/` (10/11/2026) : app Twenty (SDK natif, aucun patch, aucune fonction serveur) qui ajoute les objets `appel` et `textMessage` reliés à Person, et deux types d'activité `linked` ancrés à la date de l'appel ou du message, donc visibles dans la timeline de la personne, plus des onglets Appels et SMS sur sa fiche ; l'audio vit dans le champ FILES. Ingestion manuelle et idempotente `ingestion/crm_telephonie.py` (Pixel, enregistrements JemRec, sauvegarde S10e). Mode d'emploi et pièges : son `README.md`. 🔴 `twenty app uninstall` supprime les objets et leurs données.

`core-modules/veridian-hub-sso/`, le Hub seule source d'identité (décision Robert, 06/11/2026) :

| Route | Rôle | Contrat |
|---|---|---|
| `POST /api/sso/issue-magic-link`, `GET /auth/token?t=` | rebond ; `hub_user_id` d'abord, email pour rattacher un compte sans lien | §6bis.8 |
| `POST /api/tenants/provision`, `DELETE /api/tenants/:id` | crée utilisateur et workspace ; supprime le workspace et ses données (signature `${ts}.`) | §5.1, §5 |
| `POST /api/tenants/:id/sync-member`, `POST /api/veridian/workspaces/:id/attach-member` | ajoute un membre | §5.18.3, §5.22.2 |
| `POST /api/tenants/:id/remove-member` | retire un membre, données conservées | §5.19.2 |
| `POST /api/hub/users/sync`, `GET /api/hub/users` | copie nom, email et suppression ; liste pour l'audit | §3.8 |
| `GET /api/users/by-email` | workspaces d'une adresse : sous-domaine, plan, source, `trial_status`, `trial_ends_at` (accès agent, reconcile) | §5.12 |
| `POST /api/tenants/update-plan` | plan posé par le Hub (`free`, `pro`, `business`, `enterprise`), stocké sans effet, avec `trial_status` et `trial_ends_at` ; idempotent, plan offert immunisé (409) | CONTRAT-BILLING §3 |
| `POST /mcp` avec le JWT du Hub | porte MCP unique du Hub : ES256 vérifié par le JWKS du Hub (cache 1 h), `iss`, `aud`, `exp` ; utilisateur par `hub_user_id`, inconnu = 401 `hub_user_unknown` sans création ; sans `tenant_id`, l'espace par défaut, avec : cet espace ou 403 `tenant_not_linked` / `tenant_forbidden`, jamais un autre ; `search_help_center` hors MCP (liste, appels et préchargement de `mcp-protocol.service.ts`) tant que `HELP_CENTER_SEARCH_ENABLED` n'est pas vrai ; échangé contre le jeton d'accès Twenty de l'utilisateur, outils et droits natifs (`veridian-hub-mcp/`, `VERIDIAN_HUB_MCP_ISSUER` et `_AUDIENCE`, coupé sans elles) | CONTRAT-MCP |
| `GET /welcome` | rebond `auto=1` une seule fois ; après déconnexion, en iframe ou après un essai : page « Continuer » sans `auto` | §6bis.8.0 |

`HubOnlyIdentityGuard` refuse inscription, connexion par mot de passe, invitations, changement d'email ou de
nom, suppression de compte, de membre ou de workspace sur les résolveurs Nest, et `updateWorkspace` s'il rouvre ce que le provisioning ferme (`editableProfileFields` limité à la photo, `isPasswordAuthEnabled`, lien d'invitation). La 2FA vit au Hub seul (parente, 07/11/2026) : ses mutations sont refusées, `isTwoFactorAuthenticationEnforced` aussi. `WorkspaceMemberIdentityPreQueryHook` ferme le renommage sur les API générées. Le lien porte un login token Twenty : 15 min, à usage unique, consommé par `/verify`. Liens Hub dans
`core.keyValuePair`, aucune table neuve. Variables : `HUB_API_SECRET`, `HUB_API_SECRET_NEXT`, `HUB_URL`,
`HUB_SERVER_ADMIN_EMAILS`. Sans secret, les routes répondent 503.

Hors du lot, arbitré par le Hub le 06/11/2026 : `suspend`, `resume`, `health`, et toute clé API au provisioning (§3.8 : les clés machine restent locales).

## Coupé par variable d'environnement (job Nomad, aucun patch)

| Canal mesuré | Variable |
|---|---|
| twenty-telemetry.com, au signup | `TELEMETRY_ENABLED=false` |
| registry.npmjs.org et unpkg.com, au démarrage | `MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false` |
| connexion par mot de passe | `AUTH_PASSWORD_ENABLED=false` |
| IA (avec le patch ci-dessus) | `VERIDIAN_AI_DISABLED=true` |
| réglages modifiables depuis l'interface (le job fait seul foi) | `IS_CONFIG_VARIABLES_IN_DB_ENABLED=false` |

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
5. `scripts/ci/capture-sortante.sh <conteneur crm-postgres> <secondes>` sur le nœud du staging, pendant
   `scripts/ci/parcours-staging.py` : tout nouveau canal, nom ou IP directe, sort en code 1.

## Mesures du 07/11/2026 (image `staging-eb11192`)

Image officielle sans coupure : registry.npmjs.org, unpkg.com, twenty-telemetry.com, twenty-icons.com au
démarrage et à l'inscription ; dans le navigateur, twenty-icons.com et tradingview. Notre image : silence sur
démarrage complet et parcours, témoin vu, navigateur sans hôte tiers. Épreuves vues échouer : limite remise
à 5, fichier Enterprise modifié, envoi par nom, envoi par IP directe.

**Pool PostgreSQL (09/11/2026)** : `veridian-pg/pg-pool-resilience.util.ts`, étalé dans `core.datasource.ts` et `workspace-query-executor.service.ts` : connexion bornée (`PG_POOL_CONNECTION_TIMEOUT_MS`, 10 s), keepalive TCP, durée de vie maximale (`PG_POOL_MAX_LIFETIME_S`, 30 min). Pendant une bascule pg-saas, l'entrée TCP accepte sans qu'aucun primaire réponde : sans borne, `pool.connect()` attendait sans fin (pages à 180 s). Spec sur un socket muet, vue échouer sans la borne. `GET /healthz/base` (`veridian-pg/controllers/`) : `SELECT 1` sur le pool cœur, 503 au-delà de 2 s ; check Nomad `base` sans `check_restart` (la vivacité reste `/healthz`), tags Traefik inchangés (canari).

**Brancher mon IA (Robert, 09/11/2026)** : `GET /veridian/ia/liens` (`veridian-ia/`) lit côté serveur `HUB_URL/api/mcp/liens-installation` (3 s, cache 5 min, gardé 1 h si le Hub tombe), ne garde que les liens aux préfixes attendus, sinon `disponible: false`. Front `modules/veridian-ia/` : page `Paramètres > Connect your AI` (`SettingsPath.VeridianIa`, ouverte à tout membre), entrée de barre latérale et section en tête de la page MCP, masquées tant que les liens manquent (aucun bouton mort). Patchs amont : une valeur d'énumération, une route, un élément de réglages, une ligne dans la barre latérale et dans `SettingsMcpSetup`.
