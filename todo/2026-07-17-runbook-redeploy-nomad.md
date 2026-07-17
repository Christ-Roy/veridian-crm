# Runbook — redéployer le CRM après changement de code source (Nomad)

> **Sévérité** : 🟡 P1 (doc opérationnelle critique — sans ça on ne sait plus déployer)
> **Owner** : agent veridian-crm
> **Créé** : 2026-07-17

## Pourquoi ce ticket

Le CRM a été **migré de Dokploy vers le cluster Nomad le 2026-07-15**
(bastion → `ovh-prod`). Toute la doc de déploiement du repo (`CLAUDE.md` §5
"Chaîne CI") décrivait encore **Dokploy autoDeploy** (webhook push main,
`composeId 8zdqAAD1lkZFVAwuZ5USv`, `POST /api/compose.deploy`). **C'est mort.**

Ce runbook grave le nouveau workflow. Question posée par Robert 2026-07-17 :
*"tu as un ticket gitops au cas où si on rechange le code source ?"* → le voici.

## Où vit le CRM maintenant

| Élément | Valeur |
|---|---|
| Orchestrateur | **Nomad** (control-plane bastion Contabo, `nomad-v` CLI) |
| Job source (IaC) | `~/nomad-veridian/jobs/saas-prod/crm.nomad.hcl` |
| Nœud | `ovh-prod` (constraint `meta.provider == ovh-prod`) |
| Tasks (1 alloc, bridge, 127.0.0.1) | `crm-postgres` · `crm-redis` · `crm-server` · `crm-worker` |
| Image | `ghcr.io/christ-roy/veridian-crm:<sha7>` — **pinnée sur un SHA** (2 endroits : server + worker) |
| DB | Postgres 15 **dans l'allocation**, volume bind `/opt/veridian-lab/crm/db` sur ovh-prod (user `twenty`, db `twenty`) |
| Storage | bind `/opt/veridian-lab/crm/storage` |
| Secrets | Nomad var `nomad/jobs/crm` (APP_SECRET, PG pass, Stripe, Google, SMTP) — jamais en clair |
| URL | `crm.app.veridian.site` — **multi-workspace**, accès par subdomain (`<slug>.crm.app.veridian.site`) |
| TLS | Cloudflare edge → Traefik entrypoint `web` (pas de TLS interne) |

## ⚠️ Il n'y a PLUS d'autoDeploy

L'image est **pinnée sur un SHA** dans le HCL. Pusher du code + build GHCR ne
redéploie **rien** tout seul. Il faut **bump le SHA dans le HCL + `nomad-v deploy`**.

## Workflow : rechanger le code source du CRM

```
1. Coder sur staging (trunk-based, cf CLAUDE.md §5), push origin staging
2. CI GH Actions build l'image GHCR :
     - push staging → :staging + :staging-<sha7>
     - promotion main → :<sha7> + :latest (ancienne :latest re-taggée :rollback)
   Attendre la fin du build (~30 min) — vérifier le tag présent sur GHCR
3. Bump le tag image dans le HCL (2 occurrences : crm-server ET crm-worker) :
     image = "ghcr.io/christ-roy/veridian-crm:<NOUVEAU_sha7>"
4. cd ~/nomad-veridian && git add -A && git commit   (nomad-v refuse un job non commité)
5. nomad-v plan  ~/nomad-veridian/jobs/saas-prod/crm.nomad.hcl   (relire le diff)
6. nomad-v deploy ~/nomad-veridian/jobs/saas-prod/crm.nomad.hcl
7. Watch reboot : le server refait les migrations DB au boot → ~90s de 502
   avant healthz 200. Polling :
     curl -s -o /dev/null -w '%{http_code}' https://crm.app.veridian.site/healthz
8. Smoke : twenty doctor  (healthz + /metadata + /graphql + bearer admin)
9. nomad-v drift → doit être clean (job live == source commitée)
```

## Rollback

L'image `:rollback` sur GHCR = la `:latest` précédente. Deux voies :

```
# Voie propre (IaC) : remettre l'ancien SHA dans le HCL + redeploy
sed -i 's/:<sha_cassé>/:<sha_précédent>/g' ~/nomad-veridian/jobs/saas-prod/crm.nomad.hcl
cd ~/nomad-veridian && git commit -am "rollback crm → <sha_précédent>"
nomad-v deploy ~/nomad-veridian/jobs/saas-prod/crm.nomad.hcl

# Voie express : pointer l'image sur :rollback puis redeploy
```

## Pièges gravés (vécu 2026-07-17)

- **Multi-workspace strict** : `IS_MULTIWORKSPACE_ENABLED=true` → l'apex nu
  `crm.app.veridian.site` répond "Workspace not found". Le login se fait par
  **subdomain du workspace** (`veridian.crm.app.veridian.site`). Le cert wildcard
  `*.crm.app.veridian.site` est déclaré dans les labels Traefik du job.
- **Login Google** : exige `AUTH_GOOGLE_ENABLED=true` **ET** `AUTH_GOOGLE_CALLBACK_URL`
  (cette dernière est `@ValidateIf(AUTH_GOOGLE_ENABLED)` → **requise sinon crash
  au boot**). Callback login = `https://crm.app.veridian.site/auth/google/redirect`.
  ⚠️ Ce redirect_uri doit être whitelisté dans la Google Cloud Console (client
  `444233324288-bpsac6ia7jurhlghu4kse4qqqbc9eu73`, projet `veridian-preprod`,
  "Veridian CRM Web") — sinon `redirect_uri_mismatch`. Fait le 2026-07-17.
- 🔴 **APP_SECRET = clé de chiffrement AT-REST** (fallback `ENCRYPTION_KEY`→`APP_SECRET`
  dans `resolve-encryption-keys`). Il chiffre en DB : la `signingKey` JWT (ES256), les
  comptes mail connectés, les tokens OAuth. **DOIT rester l'HISTORIQUE Dokploy**
  (`F3NApX3w…`, Nomad var `APP_SECRET`), PAS un secret frais. Symptôme si mauvais secret :
  login échoue avec **"No active signing key available to sign asymmetric token"**
  (`getCurrentSigningKey` ne peut pas déchiffrer la clé → fallback null → throw).
  Bug vécu 2026-07-17 : le template pointait sur la Nomad var `TWENTY_APP_SECRET`
  (secret frais généré à la migration) au lieu de `APP_SECRET`. Fix = template
  `APP_SECRET={{ .APP_SECRET }}`. Si un jour on VEUT roter : mettre l'ancien en
  `FALLBACK_ENCRYPTION_KEY` pour que les vieilles enveloppes restent déchiffrables.
- **DB dans l'allocation** : la DB Postgres vit dans le job (volume bind local sur
  ovh-prod). Ne PAS reschedule le stateful ailleurs (le volume ne suit pas le nœud).
  Backups : cron prod → R2 (cf §1 SessionStart infra).
- **Boot lent** : le server fait les migrations TypeORM au boot → compter ~90s de
  502 après un deploy. Le worker a `DISABLE_DB_MIGRATIONS=true` (ne migre pas).

## Retard upstream (répond à la 2e question Robert)

Le fork est à **956 commits de retard** sur `twentyhq/twenty` main (dernier sync
`e70776f705` fin mai ; upstream HEAD `c8f0b86316` au 2026-07-17). L'image
déployée = notre HEAD (`18eb3f9`), donc **pas de retard sur notre propre code**.
Un resync upstream n'est PAS anodin : risque de casser le rebrand strict,
réintroduire des fichiers `@license Enterprise`, et écraser les patchs clean-room
(SyncStandardUiCapabilityFlags, etc.). À planifier comme un chantier dédié, pas
un `git merge upstream/main` à l'arrache. Cf `todo/done/` les tickets de sync
précédents (bump marker 29 commits) pour la méthode.
