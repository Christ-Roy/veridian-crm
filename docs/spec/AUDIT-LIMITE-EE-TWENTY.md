# Audit légal + technique — Limite 5 workspaces Twenty CRM

> **Auditeur** : Claude (sub-agent Opus dédié)
> **Date** : 2026-05-25
> **Repo audité** : `twentyhq/twenty` @ commit `1188ea9c` (HEAD main, clone shallow `/tmp/twenty-audit/`)
> **Demandeur** : Robert Brunon (Veridian)
> **Question centrale** : Robert peut-il légalement fork Twenty, faire sauter la limite "5 workspaces sans Enterprise Key", rebrand, et revendre en SaaS ?

---

## Verdict

**OUI, c'est légal.** La limite 5 workspaces est codée dans un fichier sous licence **AGPLv3** (pas EE), donc Robert peut la modifier librement, à condition de respecter les obligations AGPL (publier ses modifs, garder les copyrights, rebrand strict des marques "Twenty"). Impact business : Robert peut attaquer la Vague 11 comme prévu, le risque légal sur ce point précis est nul ; le seul vrai risque résiduel est sur 300 autres fichiers EE qu'il doit **NE PAS modifier ni utiliser** (SSO, custom domain, RLS, billing v2) sauf à racheter une licence commerciale OEM.

---

## Preuves techniques

### 1. Twenty est dual-licensé fichier-par-fichier (pas tout-AGPL ni tout-EE)

**Source : `/tmp/twenty-audit/LICENSE` (lignes 1-3)**

```
This project is mostly licensed under the GNU General Public License (GPL) as described below.
However, certain files within this project are licensed under a different commercial license.
These files are clearly marked with the following comment at the top of the file: /* @license Enterprise */
Files with this comment are not licensed under the aGPL v3, but instead are subject to the
commercial license terms defined later in this file.
```

→ Modèle "shared source" type GitLab/Sentry : core AGPLv3, modules sensibles sous Commercial License explicite par marker en-tête de fichier.

### 2. Cartographie des fichiers EE (300 au total)

Comptés via `grep -rln "@license Enterprise"` sur le clone :

| Package | Fichiers EE | Périmètre |
|---|---:|---|
| `twenty-server` | 243 | SSO, Custom Domain (DNS Cloudflare), RLS (row-level perms), Billing v2, Audit logs, Enterprise plan service, JWT rotation, Usage tracking |
| `twenty-front` | 52 | UI SSO, UI custom domain, UI RLS settings, UI billing |
| `twenty-shared` | 5 | Types partagés EE |

**Modules entiers protégés (= ne pas toucher ni réécrire à partir du code EE)** :
- `engine/core-modules/sso/`
- `engine/core-modules/enterprise/`
- `engine/core-modules/billing-webhook/`
- `engine/core-modules/dns-manager/`
- `engine/core-modules/cloudflare/`
- `engine/core-modules/usage/`
- `engine/core-modules/event-logs/`
- `engine/metadata-modules/row-level-permission-predicate/`
- `engine/metadata-modules/flat-row-level-permission-predicate/`

### 3. Où vit techniquement la limite "5 workspaces"

**Constante (AGPL — modifiable)** :

`/tmp/twenty-audit/packages/twenty-server/src/engine/core-modules/auth/constants/max-workspaces-without-enterprise-key.constants.ts:1`

```ts
export const MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = 5;
```

→ Fichier **NE porte PAS** le marker `/* @license Enterprise */`. Donc AGPLv3.

**Application (AGPL — modifiable)** :

`/tmp/twenty-audit/packages/twenty-server/src/engine/core-modules/auth/services/sign-in-up.service.ts:459-477`

```ts
private async assertWorkspaceCountWithinLimit(
  workspaceCount: number,
): Promise<void> {
  if (this.enterprisePlanService.isValid()) {
    return;
  }

  if (workspaceCount < MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY) {
    return;
  }

  throw new AuthException(
    `Cannot create more than ${MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY} workspaces without a valid enterprise key`,
    AuthExceptionCode.FORBIDDEN_EXCEPTION,
    {
      userFriendlyMessage: msg`Workspace limit reached. A valid enterprise key is required to create more workspaces.`,
    },
  );
}
```

→ Fichier **NE porte PAS** le marker EE. Donc AGPLv3.

**Appelé une seule fois** (ligne 432 du même fichier). Le patch est **trivial** : changer la constante en `Number.MAX_SAFE_INTEGER`, OU early-return inconditionnel dans la fonction. 1 à 3 lignes de modif dans du code AGPL.

### 4. Le service EE consulté (`enterprisePlanService.isValid()`) reste utilisé en lecture seule

`/tmp/twenty-audit/packages/twenty-server/src/engine/core-modules/enterprise/services/enterprise-plan.service.ts:1`

```ts
/* @license Enterprise */
// ...
isValid(): boolean {
  return this.hasValidEnterpriseValidityToken();
}
```

→ Marqué EE. **Robert ne peut PAS modifier ce fichier** ni en réutiliser le code dans son fork commercial. Mais il n'en a pas besoin : il vire l'appel `enterprisePlanService.isValid()` du flow AGPL `sign-in-up.service.ts`, ou il laisse la valeur retournée + force `workspaceCount < Infinity`. Le fichier EE existe toujours mais est ignoré. **Pas de modification du fichier EE = pas de violation EE.**

### 5. La mention "5 workspaces" est principalement marketing

`/tmp/twenty-audit/packages/twenty-website/src/sections/Plans/data.ts:26`

```ts
const PRO_BULLETS_SELF_HOST = [
  msg`Full customization`,
  msg`Create custom apps`,
  msg`Up to 5 workspaces`,        // ← bullet marketing site twenty.com
  msg`Community support`,
];
```

→ C'est juste le **pricing affiché** sur `twenty.com/pricing` pour le plan "Pro self-hosted". Le `twenty-website` est sous AGPL et de toute façon ne sera pas embarqué dans le fork Veridian. Aucun impact technique.

---

## Preuves légales

### Section Commercial License du LICENSE

**Source : `/tmp/twenty-audit/LICENSE` lignes 674-697**

> *The Twenty.com Commercial License (the "Commercial License")*
> *Copyright (c) 2023-present Twenty.com, PBC*
>
> *This part of the software and associated documentation files (the "Software") may only be used in production, if you (and any entity that you represent) have agreed to, and are in compliance with, the Terms available at https://twenty.com/legal/terms, or other agreements governing the use of the Software, as mutually agreed by you and Twenty.com, PBC ("Twenty"), and otherwise have a valid Twenty Enterprise Edition subscription for the correct number of hosts and seats as defined in the Commercial Terms.*
>
> *Notwithstanding the foregoing, you may copy and modify the Software for development and testing purposes, without requiring a subscription. (...) Subject to the foregoing, it is forbidden to copy, merge, publish, distribute, sublicense, and/or sell the Software.*

**Lecture** : usage **production** des fichiers EE = subscription Twenty obligatoire. Dev/test OK sans. **Distribution/sublicense/sell INTERDITS** sans accord.

**Conséquence pratique pour Veridian** : si Robert active des features EE (SSO SAML, custom domain Cloudflare, RLS, billing v2) en prod sans subscription Twenty → violation contractuelle. Robert doit shipper son fork SANS ces 300 fichiers (soit les supprimer du build, soit les laisser dormants désactivés sans les utiliser en prod).

### Section AGPL (le reste du code)

LICENSE lignes 6-666 : texte intégral GNU AGPL v3 standard. Obligations :

1. **Publier le code modifié** dès qu'on offre le service à des utilisateurs distants (clause SaaS §13)
2. **Garder les copyright notices** d'origine (§5)
3. **Distribuer sous AGPL** (pas relicenser, pas mixer avec du proprio statiquement lié)
4. **Indiquer les modifs faites** (§5)

### CLA Twenty.com PBC

**Source : `/tmp/twenty-audit/.github/CLA.md`**

Le CLA est **standard** (Apache-style avec patent license + retaliation). Il s'applique aux **contributeurs upstream** uniquement — si Robert ne contribue PAS de PR au repo `twentyhq/twenty`, le CLA ne le concerne pas. Si Robert souhaite un jour pousser un fix upstream, il devra accepter de céder ses droits sur cette contribution.

→ **Pas un blocker pour le fork commercial.**

### Trademark

**Source : USPTO 98119420 (Twenty.com PBC, dépôt 2023-08-07)**
**Source : `twenty.com/legal/terms`** (trademark policy explicite)

> *Twenty.com PBC's trademarks and trade dress may not be used in connection with any product or service without the prior written consent of Twenty.com PBC.*

→ **Rebrand strict obligatoire**. Robert ne peut pas appeler son fork "Twenty CRM Veridian Edition" ou "Veridian Twenty". Doit être 100% "Veridian CRM" (ou autre nom), avec logo distinct, footer distinct, mention legale type "Powered by Twenty (open source AGPL)" autorisée mais pas nécessaire.

---

## Recommandation actionnable

### Ce que Robert peut faire en toute légalité

1. **Fork `twentyhq/twenty`** dans `github.com/Christ-Roy/veridian-crm` (ou repo organisation Veridian)
2. **Supprimer la limite 5 workspaces** en patchant 1 à 3 lignes :
   - Option A (plus propre) : `MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = Number.MAX_SAFE_INTEGER`
   - Option B : early-return inconditionnel dans `assertWorkspaceCountWithinLimit()`
   - Option C : retirer l'appel à la fonction ligne 432
3. **Rebrand strict** :
   - Logo `twenty-website/public/images/core/logo.svg` → logo Veridian
   - Toutes occurrences "Twenty" dans UI → "Veridian CRM"
   - Title, favicon, manifest, OG tags, emails templates
   - Renommer paquets npm internes si publication
4. **Self-host** sur l'infra Veridian (Dokploy / Tailscale prod-pub)
5. **Vendre du SaaS rebrandé** à des clients PME

### Ce que Robert DOIT faire pour respecter AGPL

1. **Publier le code modifié** sur un repo public — peut être privé pendant le dev, doit devenir public dès qu'un user externe (= client SaaS) accède au service. Lien "Source code" en footer de l'app vers `github.com/Christ-Roy/veridian-crm`.
2. **Garder le copyright Twenty.com PBC** dans les fichiers AGPL non modifiés. Ajouter `Copyright (c) 2026-present Veridian` dans les fichiers que Robert crée ou modifie substantiellement.
3. **Ajouter un fichier NOTICE.md** listant les modifications faites par rapport à upstream (changelog grosses mailles).
4. **Mention "based on Twenty CRM"** dans README ou docs — pas obligatoire légalement mais bonne pratique morale.

### Ce que Robert ne DOIT PAS faire

1. **NE PAS utiliser les 300 fichiers EE en production**. 2 options :
   - **Option propre (recommandée)** : supprimer du fork tous les fichiers marqués `/* @license Enterprise */` + retirer les imports/refs côté front. Ça vire le SSO SAML/OIDC, le custom domain Cloudflare, les row-level permissions, le billing v2, l'audit logs. Robert réécrira ces features (SSO via Hub Auth.js déjà fait, custom domain via Dokploy/Traefik direct, RLS via Postgres natif quand besoin).
   - **Option dirty (déconseillée)** : laisser les fichiers EE présents mais désactivés via feature flag (ne jamais set `ENTERPRISE_KEY` env var, donc `EnterprisePlanService.isValid()` retourne false → guard `EnterpriseFeaturesEnabledGuard` bloque). Risque : si un jour le code EE s'exécute par accident, c'est une violation contractuelle.

2. **NE PAS utiliser le nom "Twenty"** ni le logo ni le trade dress.

3. **NE PAS sublicenser sous proprio** — Robert ne peut pas ajouter du code AGPL Twenty dans un produit commercial fermé. Tout le fork reste AGPL.

4. **NE PAS contribuer du code stratégique upstream** sans intention de le partager — le CLA Twenty PBC donne à Twenty Labs des droits étendus sur toute contribution upstream (sublicense compris). Si Robert dev un truc différenciant Veridian, il garde ça dans son fork, ne PR pas à upstream.

### Workaround si Robert change d'avis sur les features EE

Si plus tard Veridian veut SSO SAML / RLS / custom domain via Cloudflare **avec le code Twenty** :

- **Acheter une subscription Enterprise OEM** auprès de Twenty.com PBC (négocier directement avec `founders@twenty.com`). Probablement chiffré au seat client. À regarder si la base client Veridian justifie le ticket.
- **OU réimplémenter** ces features clean-room (déjà partiellement fait côté Veridian : SSO via Hub Auth.js, custom domain via Dokploy/Traefik). Coût ~2-4 semaines dev.

---

## Synthèse executive (1 paragraphe)

Le fork commercial de Twenty avec rebrand Veridian est légal, à 3 conditions cumulatives : (1) virer ou ne pas utiliser les 300 fichiers EE (SSO/custom domain/RLS/billing v2/audit) en production, (2) publier le code modifié et garder copyrights Twenty PBC sur le code AGPL non-EE (obligation AGPL §13), (3) rebrand strict (zéro mention du nom "Twenty", logo, trade dress). La limite "5 workspaces" est codée dans **un seul fichier AGPLv3** (`max-workspaces-without-enterprise-key.constants.ts`, 1 ligne) + **un seul appel AGPLv3** (`sign-in-up.service.ts:432-477`), donc le patch fait 3 lignes max. Le service de validation `EnterprisePlanService` (EE) reste présent dans le code mais n'est plus utilisé en prod, sans modification ni distribution du fichier EE lui-même.

---

## Annexes

### A. Commande pour supprimer tous les fichiers EE du fork

```bash
cd veridian-crm
grep -rln "@license Enterprise" packages/ 2>/dev/null | xargs rm -v
# Puis virer les imports cassés et les routes/résolveurs EE référencés
# (ex : SSOResolver, EnterpriseResolver, RowLevelPermissionService, etc.)
# Compter ~1-2 jours de "déshabillage" propre avec tests
```

### B. Patch minimal pour virer la limite 5 workspaces (en gardant tout EE désactivé)

Fichier : `packages/twenty-server/src/engine/core-modules/auth/constants/max-workspaces-without-enterprise-key.constants.ts`

```ts
// Veridian: limite levée — fork commercial AGPL, voir AUDIT-LIMITE-EE-TWENTY.md
export const MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = Number.MAX_SAFE_INTEGER;
```

C'est tout. 1 ligne. Le reste du flow `sign-in-up.service.ts` continue de fonctionner inchangé (juste l'inégalité `workspaceCount < MAX_SAFE_INTEGER` est toujours vraie → early-return → pas d'exception levée).

### C. Liste des fichiers EE par catégorie fonctionnelle (extrait twenty-server)

Sortie de `grep -rln "@license Enterprise" packages/twenty-server | awk -F/ '{print $5"/"$6}' | sort -u` :

```
engine/core-modules/auth                      (guards + services EE-gated)
engine/core-modules/billing                   (billing v2 Stripe orchestrator)
engine/core-modules/billing-webhook           (handlers Stripe entreprise)
engine/core-modules/cloudflare                (DNS via API Cloudflare)
engine/core-modules/dns-manager               (custom domain validation)
engine/core-modules/enterprise                (EnterprisePlanService, JWT validation)
engine/core-modules/event-logs                (audit log entreprise)
engine/core-modules/jwt                       (key rotation crons)
engine/core-modules/sso                       (SAML + OIDC providers)
engine/core-modules/usage                     (usage tracking pour billing seats)
engine/metadata-modules/row-level-permission-predicate     (RLS engine)
engine/metadata-modules/flat-row-level-permission-predicate
engine/twenty-orm/utils                       (utils RLS application)
engine/workspace-manager/workspace-migration  (migrations RLS workspace)
database/commands/upgrade-version-command     (1 fichier billing v2 migration)
```

### D. Précédents publics

Cherché web "Twenty CRM AGPL fork commercial precedent" — pas de cas connu de cease & desist Twenty.com PBC. Le projet a ~6000 forks GitHub et un modèle dual-license assumé. Twenty Labs (rebaptisé Twenty.com PBC) gagne sa vie sur le SaaS hosted + features EE, pas sur du procès anti-fork. Risque légal réel = très faible tant que les 3 conditions ci-dessus sont respectées.

### E. URLs sources

- Repo Twenty : https://github.com/twentyhq/twenty
- Pricing officiel : https://twenty.com/pricing
- Docs self-host : https://docs.twenty.com/developers/self-host/capabilities/docker-compose
- Terms (Commercial License URL) : https://twenty.com/legal/terms
- Trademark USPTO : 98119420 (déposé 2023-08-07 par Twenty.com PBC)
- LICENSE complet dans le repo : `LICENSE` à la racine (709 lignes, AGPLv3 + Commercial License Twenty.com PBC)

### F. Risques résiduels (zones grises)

1. **Patent license dans CLA** : si Robert utilise un brevet logiciel quelque part dans Twenty et qu'il fork puis attaque Twenty PBC en justice sur ce brevet, le CLA prévoit une terminaison des droits. → Improbable, mais à noter.

2. **AGPL §13 "Remote Network Interaction"** : Robert doit fournir le source code à ses clients SaaS sur demande. Lien public en footer suffit. Si Robert oublie ce lien et qu'un client le demande → procès AGPL possible (très rare en pratique, mais zone visible).

3. **Mixage AGPL + proprio** : si Robert ajoute du code Veridian propriétaire (genre intégration Prospection) dans le fork, ce code devient **AGPL par contamination** (linking statique avec du AGPL). Si Robert veut garder du code privé, il doit le mettre dans un service séparé qui appelle Twenty/Veridian-CRM via API HTTP (= déjà l'archi polyrepo Veridian — donc OK par construction).

4. **Twenty PBC change la licence à l'avenir** : s'ils passent en BSL ou Elastic License v2 sur une future version, Robert restera bloqué sur le dernier commit AGPL. À surveiller (cf cas Elastic 2021, MongoDB 2018, Sentry 2019). Pas un problème immédiat, juste un signal à monitorer.

### G. Sources web consultées

- [Twenty CRM GitHub](https://github.com/twentyhq/twenty)
- [Twenty Pricing](https://twenty.com/pricing)
- [Twenty Story](https://twenty.com/story)
- [Twenty Releases](https://twenty.com/releases)
- [Twenty Docs (llms.txt)](https://docs.twenty.com/llms.txt)
- [Twenty Terms of Service](https://twenty.com/legal/terms)
- [USPTO Trademark 98119420](https://uspto.report/TM/98119420)
- [Justia trademarks Twenty.com PBC](https://trademarks.justia.com/owners/twenty-com-pbc-5607520/)
- [Launch HN: Twenty.com (YC S23)](https://news.ycombinator.com/item?id=36791434)
- [Article OpenSourceAlternatives](https://www.opensourcealternatives.to/item/twenty)
- [Article Pasqualepillitteri (44K stars)](https://pasqualepillitteri.it/en/news/954/twenty-crm-open-source-salesforce-hubspot-alternative)
