# SSO SAML 2.0 / OIDC — module clean-room AGPL `veridian-sso`

> **Auteur** : agent `ee-sso` (Opus) — team `crm-ee-cleanroom`
> **Date** : 2026-06-14
> **Statut** : implémenté (staging)
> **Licence** : AGPLv3 (module Veridian neuf, zéro code EE Twenty lu/copié)

---

## 0. Pourquoi clean-room

Twenty fournit le SSO entreprise dans `engine/core-modules/sso/` et
`auth/controllers/sso-auth.controller.ts` + `auth/strategies/{saml,oidc}.*` —
**tous marqués `/* @license Enterprise */`** (cf `AUDIT-LIMITE-EE-TWENTY.md`).
On NE LES OUVRE PAS, on NE LES COPIE PAS.

Le SSO est la feature EE **la plus sûre à réécrire** : SAML 2.0 et OIDC sont des
protocoles standards documentés publiquement (specs OASIS / OpenID Foundation),
implémentés par des libs publiques (`@node-saml/node-saml`, `openid-client`)
déjà présentes dans les dépendances de `twenty-server`. On réécrit le comportement
depuis ces standards, pas depuis le code Twenty.

Ce module se branche **uniquement** sur des points d'accroche **AGPL** du flow
auth de Twenty (cf §4). Il ne modifie aucun fichier EE.

---

## 1. Comportement attendu (vue produit)

1. Un **admin de workspace** déclare un IdP (Okta, Azure AD / Entra,
   Google Workspace, Keycloak, OneLogin…) en SAML 2.0 ou OIDC.
   - SAML : `entryPoint` (SSO URL IdP), `idpCert` (cert de signature IdP),
     `issuer` (entityID SP, = nous).
   - OIDC : `issuerUrl` (discovery `.well-known`), `clientId`, `clientSecret`.
2. Les **users de ce workspace** se loggent via l'IdP au lieu du
   couple email/mot de passe.
   - Init : `GET /auth/sso/:providerId/login` → redirige vers l'IdP.
   - Retour : SAML `POST /auth/sso/:providerId/acs`, OIDC
     `GET /auth/sso/:providerId/callback`.
3. **JIT provisioning** : au 1er login d'un user inconnu mais autorisé sur le
   workspace, le compte est créé automatiquement et rattaché au workspace
   (pas d'invitation préalable nécessaire). Aux logins suivants, le user
   existant est simplement ré-attaché / connecté.
4. Une fois l'identité validée + le user provisionné, on génère un
   **loginToken** Twenty natif et on redirige vers `/verify?loginToken=…`
   exactement comme le fait l'OAuth Google/Microsoft AGPL. Le front Twenty
   consomme ce loginToken via le flow existant `getAuthTokensFromLoginToken`.

**Hors scope v1** (tickets de suivi si besoin client) :
- SLO (Single Logout) — endpoints prévus mais non câblés sur le flow Twenty.
- SCIM provisioning (push depuis l'IdP) — JIT-pull suffit pour démarrer.
- Mapping de rôles IdP → rôles Twenty (tous les users SSO ont le rôle membre
  par défaut du workspace ; le mapping fin est un ticket ultérieur).
- UI de configuration front (l'admin configure via API / seed pour la v1 ;
  UI à câbler dans `veridian-front/modules/veridian-sso`).

---

## 2. Architecture du module

```
packages/twenty-server/src/engine/core-modules/veridian-sso/
├── veridian-sso.module.ts                       # NestJS module
├── entities/
│   └── veridian-sso-provider.entity.ts          # config IdP par workspace (config chiffrée)
├── enums/
│   └── veridian-sso-provider-type.enum.ts       # SAML | OIDC
├── types/
│   └── veridian-sso-identity.type.ts            # identité normalisée post-validation IdP
├── services/
│   ├── veridian-sso-provider.service.ts         # CRUD provider + (dé)chiffrement config
│   ├── veridian-saml.service.ts                 # wrap @node-saml/node-saml
│   ├── veridian-oidc.service.ts                 # wrap openid-client v5
│   └── veridian-sso-auth.service.ts             # orchestration : identité → JIT → loginToken → redirect
└── controllers/
    └── veridian-sso.controller.ts               # endpoints REST /auth/sso/*
```

### 2.1 Entité `VeridianSsoProvider`

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid PK | |
| `workspaceId` | uuid | FK logique workspace (1 workspace → N providers) |
| `type` | enum `SAML` \| `OIDC` | |
| `name` | text | libellé affiché (ex. « Okta », « Azure AD ») |
| `isEnabled` | bool | provider actif ou non |
| `encryptedConfig` | text | config IdP **chiffrée** (AES-256-GCM enc:v2, AAD = workspaceId) |
| `createdAt` / `updatedAt` | tstz | |

La config en clair (jamais persistée en clair) est une union typée :

```ts
// SAML
{ entryPoint: string; idpCert: string | string[]; issuer: string;
  wantAssertionsSigned?: boolean; identifierFormat?: string;
  emailAttribute?: string; firstNameAttribute?: string; lastNameAttribute?: string }

// OIDC
{ issuerUrl: string; clientId: string; clientSecret: string;
  scope?: string; emailClaim?: string; firstNameClaim?: string; lastNameClaim?: string }
```

Le chiffrement réutilise le **`SecretEncryptionService` AGPL natif** de Twenty
(`core-modules/secret-encryption`), méthode `encryptVersioned` /
`decryptVersioned` (AES-256-GCM, clé dérivée de l'env, AAD lié au workspaceId).
**Aucun crypto maison.**

### 2.2 Identité normalisée

Les deux protocoles produisent la même structure (point de convergence) :

```ts
type VeridianSsoIdentity = {
  email: string;        // identifiant principal (lowercased)
  firstName?: string;
  lastName?: string;
};
```

---

## 3. Flow technique (séquence)

### 3.1 SAML 2.0 (SP-initiated, HTTP-POST binding)

```
Browser            CRM (/auth/sso/:id/*)          IdP (Okta/Azure…)
  │  GET /login          │                              │
  │─────────────────────►│ getLoginUrl()                │
  │                       │ node-saml.getAuthorizeUrlAsync
  │◄──── 302 ────────────│                              │
  │──────────────────────┼─────────────────────────────►│  (user s'authentifie)
  │                       │                              │
  │  POST /acs (SAMLResponse, RelayState)                │
  │◄──────────────────────────────────────────────────  │  302 vers /acs
  │─────────────────────►│ validateSamlResponse()        │
  │                       │ node-saml.validatePostResponseAsync
  │                       │ → profile {email, …}          │
  │                       │ → JIT signInUp                │
  │                       │ → generateLoginToken (AGPL)   │
  │◄──── 302 /verify?loginToken=… ───────────────────────│
```

### 3.2 OIDC (Authorization Code flow, openid-client v5)

```
GET /login → Issuer.discover(issuerUrl) → new Client() → client.authorizationUrl({state, nonce, scope})
           → 302 IdP
GET /callback?code&state → client.callbackParams() → client.callback(redirectUri, params, {state, nonce})
           → tokenSet.claims() + client.userinfo() → identité {email, …}
           → JIT signInUp → generateLoginToken (AGPL) → 302 /verify?loginToken=…
```

`state` (CSRF) et `nonce` (anti-replay ID token) sont signés dans un cookie
court (`veridian_sso_oidc`, httpOnly, sameSite=lax, 10 min) — pas de session
serveur, cohérent avec le modèle stateless de Twenty.

---

## 4. Points d'accroche AGPL utilisés (CRITIQUE — traçabilité légale)

Tous vérifiés `head -1` = pas de marker `/* @license Enterprise */` :

| Brique réutilisée | Fichier | Licence |
|---|---|---|
| `SignInUpService.signInUp(...)` (JIT : crée/attache user au workspace) | `auth/services/sign-in-up.service.ts` | ✅ AGPL |
| `SignInUpService.signUpWithoutWorkspace(...)` | idem | ✅ AGPL |
| `LoginTokenService.generateLoginToken(email, workspaceId, AuthProviderEnum.SSO)` | `auth/token/services/login-token.service.ts` | ✅ AGPL (exporté par AuthModule) |
| `AuthService.computeRedirectURI(...)` + `findWorkspaceForSignInUp` + `formatUserDataPayload` + `checkAccessForSignIn` | `auth/services/auth.service.ts` | ✅ AGPL |
| `AuthSsoService.findWorkspaceFromWorkspaceIdOrAuthProvider(...)` | `auth/services/auth-sso.service.ts` | ✅ AGPL |
| `WorkspaceDomainsService.buildWorkspaceURL(...)` | `domain/workspace-domains/services/workspace-domains.service.ts` | ✅ AGPL (exporté) |
| `SecretEncryptionService.encryptVersioned/decryptVersioned` | `secret-encryption/secret-encryption.service.ts` | ✅ AGPL |
| `AuthProviderEnum.SSO` | `workspace/types/workspace.type.ts` | ✅ AGPL |
| `AppPath.Verify` | `twenty-shared/types/AppPath.ts` | ✅ AGPL |

Le pattern reproduit est **exactement** celui de l'OAuth Google/Microsoft AGPL
de Twenty (`AuthService.signInUpWithSocialSSO`, lignes ~1015-1092 de
`auth.service.ts`) : résoudre workspace → formater identité → `signInUp` JIT →
`generateLoginToken` → `computeRedirectURI`. On observe ce comportement AGPL et
on le réutilise via injection de service ; on ne touche pas à la version EE du
controller SSO.

**Seule modification d'un fichier AGPL core** : ajout de `SignInUpService` et
`AuthService` à la liste `exports:` de `auth.module.ts` (2 lignes, AGPL, aucun
fichier EE touché) afin que `veridian-sso` puisse les injecter proprement.

---

## 5. Sécurité

- Config IdP (dont `clientSecret` OIDC, certs) **chiffrée au repos** via
  `SecretEncryptionService` (AES-256-GCM, AAD = workspaceId) — jamais en clair
  en DB ni dans les logs.
- SAML : signature de la réponse IdP **vérifiée** (`idpCert`,
  `wantAuthnResponseSigned` / `wantAssertionsSigned` activables) ; `InResponseTo`
  / audience validés par node-saml.
- OIDC : `state` (CSRF) + `nonce` (anti-replay) obligatoires, cookie httpOnly
  signé, PKCE si l'IdP le supporte.
- `email` lowercased et requis : une réponse IdP sans email → rejet.
- Le provider doit être `isEnabled` ET correspondre au `workspaceId` ; un
  `providerId` inconnu/désactivé → 404, pas de fuite d'info.
- JIT borné : le user n'est provisionné que sur **le workspace du provider**,
  jamais ailleurs.

---

## 6. Tests (`*.veridian.spec.ts`)

- `veridian-saml.service.veridian.spec.ts` : génération URL login + validation
  d'une SAMLResponse mockée (node-saml mocké) → identité ; rejet si pas d'email.
- `veridian-oidc.service.veridian.spec.ts` : authorizationUrl, callback mocké
  (openid-client mocké) → identité depuis claims/userinfo.
- `veridian-sso-provider.service.veridian.spec.ts` : chiffrement round-trip de
  la config (SecretEncryptionService mocké), CRUD, garde isEnabled/workspaceId.
- `veridian-sso-auth.service.veridian.spec.ts` : orchestration JIT → loginToken
  → redirect (SignInUpService / LoginTokenService / AuthService mockés),
  vérifie que `generateLoginToken` est appelé avec `AuthProviderEnum.SSO` et le
  bon workspaceId, et que l'URL de redirect pointe sur `/verify?loginToken=`.

Convention `.veridian.spec.ts` = suffixe des patches Veridian, ciblé par la CI
`veridian-crm-ci.yaml` (pas de build Twenty complet local).

---

## 7. Déploiement / migration

- Nouvelle table `veridianSsoProvider` (entité TypeORM ci-dessus) → migration
  versionnée à générer côté CI/serveur (zéro `nx`/build local).
- Endpoints REST exposés sous `/auth/sso/*` (hors GraphQL, comme les controllers
  OAuth existants).
- Variables d'env : aucune nouvelle (réutilise `APP_SECRET` /
  clés de `SecretEncryptionService` déjà configurées + `FRONT_BASE_URL` /
  domaines workspace déjà gérés par `WorkspaceDomainsService`).
- Config admin v1 : par API/seed (UI front = ticket de suivi).

---

## 8. Évolution future

- UI front `veridian-front/modules/veridian-sso` (page Settings → SSO).
- Mapping rôles IdP → rôles Twenty.
- SLO (Single Logout).
- SCIM (provisioning push).
- Multi-provider par workspace avec sélection au login (déjà supporté côté
  entité : N providers / workspace).
