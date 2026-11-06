# Legacy Twenty Hub integration (référence v1.16)

> Code extrait du monorepo `veridian-infra` (SHA `7e8d782b^`, avant l'extraction
> polyrepo du 2026-05-13). Il s'agit du dernier état stable du module Hub→Twenty
> AVANT la sortie de Twenty de la stack en 2026-05-18.
>
> **Statut** : référence historique. **À ne PAS recopier tel quel** car écrit
> pour Twenty v1.16. Notre fork actuel tourne sur ≈ v2.8.

## Fichiers

- `create-tenant-v1.16-legacy.ts` — `POST /api/twenty/create-tenant` Hub.
  Flow 9 étapes : signUp → signIn → workspace → tokens → activate → roles → apiKey → token → upsert tenant.
- `regenerate-login-v1.16-legacy.ts` — `POST /api/twenty/regenerate-login` Hub.
  Permet de regénérer un magic link sans recréer le tenant.

## Différences critiques v1.16 → v2.8 (validées en réel le 2026-05-27)

**🔴 Endpoint des mutations Auth** :
- v1.16 : `/graphql`
- v2.8 : **`/metadata`** (les mutations Auth sont sur le schema "metadata", pas "core")
- `/graphql` ne contient plus que les objets data (Person, Company, custom objects)

**🔴 Mutations renommées** :
| v1.16 | v2.8 |
|---|---|
| `signUp(email, password)` | `signUpInWorkspace(email, password)` |
| `signIn(email, password)` | `getLoginTokenFromCredentials(email, password, origin)` ← **arg `origin` obligatoire** |
| `signUpInNewWorkspace` (sans args, créait un nouveau workspace pour user existant) | toujours là, même signature |
| `activateWorkspace(data: ActivateWorkspaceInput)` | identique |
| `createApiKey(input: CreateApiKeyDTO)` | `createApiKey(input: **CreateApiKeyInput**)` ← type renommé |
| `generateApiKeyToken(apiKeyId, expiresAt)` | identique |
| `getAuthTokensFromLoginToken(loginToken, origin)` | identique |

**🔴 `getRoles` order** :
- v1.16 : premier role retourné = Admin (ou unique)
- v2.8 : **premier role = "Member"**, deuxième = "Admin" → **filter `r.label === 'Admin'`** pour récupérer l'admin role.

**🟡 Captcha bypass** :
- En v2.8, le `CaptchaGuard` retourne `success: true` direct si aucun driver Captcha n'est configuré (= aucune ENV `CAPTCHA_DRIVER`, `CAPTCHA_SITE_KEY`, etc.). C'est notre cas en staging et prod Veridian.

**🟢 Subdomain auto** :
- v2.8 : `signUpInWorkspace` génère le subdomain à partir du domaine email (`robert.brunon@veridian.site` → subdomain `veridian` → URL `https://veridian.crm.staging.veridian.site/`). Pas besoin de le passer manuellement.

**🟢 SignUpDTO réponse** :
- v2.8 retourne `{ loginToken { token expiresAt }, workspace { id workspaceUrls { subdomainUrl } } }` — pareil que v1.16 modulo le nom du subfield (`subdomainUrl` au lieu de `workspaceUrl`).

## Validation terrain 2026-05-27

Le flow complet 6 étapes (signUp → token exchange → activate → getRoles → createApiKey → generateApiKeyToken) a été **exécuté en direct sur `https://crm.staging.veridian.site/`** par l'agent veridian-crm. Tenant créé pour `robert.brunon@veridian.site`, API key Bearer obtenue valide 1 an, push d'un lead test via `POST /rest/people` réussi.

Le ticket `veridian-hub/todo/2026-05-27-route-admin-create-crm-tenant.md` documente le flow validé prêt-à-coder avec exemples curl reproductibles.
