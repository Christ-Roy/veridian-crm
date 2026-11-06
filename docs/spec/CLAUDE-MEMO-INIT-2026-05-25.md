# `veridian-crm/` — Pré-projet futur produit Veridian CRM

> Mémo pour Claude (et Robert plus tard) : pourquoi on en est là, qu'est-ce qui a été tranché, qu'est-ce qui reste ouvert.
>
> **État actuel** : dossier de spec uniquement. Pas encore un repo git. Pas encore un fork. Tout ce qui est ici sert à préparer la décision finale + le démarrage du sprint Vague 11 quand on attaquera vraiment.
>
> **Positionnement polyrepo** : ce dossier vit à la racine `veridian-platform/` à côté des autres apps (`veridian-hub`, `veridian-prospection`, `veridian-cms`, `notifuse-veridian`, `veridian-analytics`, `veridian-infra`). Quand on attaquera la Vague 11, il deviendra le fork cloné de `twentyhq/twenty` (avec rebrand Veridian).

## Contexte d'origine (session 2026-05-25)

Pendant la Vague 8 de Prospection (timeline + IMAP réception), Robert pose la question : "j'ai besoin que prospection soit complètement customisable, à savoir un peu comme Twenty CRM qui est 100% customisable, tu en penses quoi ?"

Première réaction du team-lead Claude (verbatim mémoire) : **"non, ou alors plus tard et différemment"**. Justification :
- Twenty est méta-modélisé 100% (Object/Field/View dynamiques DB) = réécriture du produit, pas extension
- Veridian Prospection a 996K leads pré-enrichis avec schéma figé = différenciateur produit
- Solo dev = 6 mois mini pour réécrire l'archi
- Risque de diluer le positionnement (prospection lead-gen vs CRM customisable = 2 produits différents)

Première contre-proposition du team-lead : "tu veux probablement Custom Fields JSONB + Vues sauvegardées + Workflows light, pas vraiment Twenty-style". Effort ~2 semaines vs 6 mois.

## Évolution du brainstorm

### Étape 1 — Agent audit Twenty (1er passage)

Robert demande : "envoie un agent qui propose un ticket pour notre demande après audit Twenty et ce qu'on a et plusieurs voies possibles, on tranchera ensemble".

Agent recherche livre `todo/2026-05-25-vision-customisation-crm-audit-twenty.md` avec **6 voies** :
- A : Custom Fields JSONB (~3 j-h)
- B : Vues sauvegardées + custom fields (~1 sem)
- C : Briques génériques workflows + webhooks + tout B (~3 sem)
- **D : Méta-modèle léger maison** (~6 sem) ← **reco agent**
- E : Twenty-style 100% (~6 mois solo, déconseillé)
- F : Intégrer Twenty existant via twentyWorkspaceId déjà présent dans le schéma

Verdict agent : Voie D recommandée, Voie E formellement déconseillée pour un solo.

### Étape 2 — Robert décide en sens inverse (mais avec lucidité)

Robert répond : **"on va partir sur un nouveau produit, il faut séparer les deux, ça évitera de repartir de zéro. Au pire Prospection servira pour faire du cold et on essayera petit à petit de le déshabiller de ses features en doublon avec le CRM quand il sera prêt."**

Stratégie produit verrouillée :
- 2 produits séparés (Prospection cold + CRM customisable)
- Migration progressive (pas de big bang)
- Prospection garde le rôle data + cold
- Le CRM consomme Prospection comme API (leads qualifiés on-demand) + Notifuse pour les campagnes

### Étape 3 — Agent recherche licence Twenty

Robert demande : "on a le droit de rebrand Twenty à partir des dernières versions avec EE ?"

Agent recherche `todo/2026-05-25-twenty-licence-rebrand-EE-research.md` livre :
- **Twenty CE = AGPLv3** (pas MIT)
- Fork + rebrand + revente SaaS autorisé sous obligation de publication des modifs
- Interdiction trademark "Twenty" — rebrand strict obligatoire
- Twenty EE existe (features SSO/RBAC/Audit/Workflows avancés) — sous licence commerciale séparée
- 4 voies proposées : Fork CE + dev EE-like (reco), Acheter EE OEM, Clean room, Partnership

Verdict : **autorisé, conditionné**.

### Étape 4 — Robert tranche AGPL acceptée

Robert : "Oui, on accepte l'AGPL et on publie le rebrand + nos ajouts". Justification implicite : moat Veridian = data 996K + service consulting + intégration cross-app, pas le code.

### Étape 5 — Choix MVP scope

Robert : MVP minimum viable = Twenty CE forké + rebrand + auth Hub + 1 client consulting validé (~1.5-2 mois). Pas de workflows ni RBAC custom dans le MVP.

Ordre stratégique : **on déshabille Prospection uniquement quand en interne on aura migré vers Twenty rebrandé.** Approche pragmatique zero-risk.

### Étape 6 — Création du dossier `customisable-crm/` (état actuel)

Team-lead écrit 9 fichiers de spec pour cadrer la future Vague 11 :
- `00-VISION.md` — décisions Robert verrouillées
- `01-archi-meta-modele.md` — archi Twenty + adaptations Veridian
- `02-rebrand-checklist.md` — tout ce qu'il faut rebrand
- `03-integration-hub-auth.md` — auth + billing + provisioning via HMAC Hub
- `04-module-leads-b2b.md` — pull leads qualifiés depuis Prospection
- `05-module-notifuse-mail.md` — push campagnes vers Notifuse
- `06-deploiement-infra.md` — Dokploy + Traefik + CI/CD
- `07-sprint-decomposition.md` — Vague 11.1-11.5 (~8 sem, ~14 agents cumul)
- `08-questions-ouvertes.md` — 13 questions pour Robert avant attaque

### Étape 7 — Demande d'audit micro

Robert : "laisse un TODO P0 pour auditer plus en détail dans le repo Twenty, je vais brainstormer avec l'agent dédié".

Création du ticket `AUDIT-TWENTY-DETAIL-P0.md` — 30+ questions techniques précises qu'un agent dédié devra creuser dans le repo cloné avant qu'on attaque la Vague 11.

## État actuel (à la fin session 2026-05-25)

- ✅ Stratégie produit verrouillée (2 produits séparés, fork Twenty CE, AGPLv3)
- ✅ Plan giga-sprint Vague 11 cadré (8 sem, 14 agents cumul)
- ⏳ **En attente** : audit Twenty micro (P0, ticket `AUDIT-TWENTY-DETAIL-P0.md`)
- ⏳ **En attente** : promo prod Prospection Vague 9-10 avant d'engager Vague 11
- ⏳ **En attente** : 13 questions ouvertes à trancher (cf `08-questions-ouvertes.md`)

## Comment Claude doit aborder ce dossier dans les sessions futures

### Si Robert dit "spawn l'agent audit Twenty"
→ Spawn 1 agent Opus en background avec `AUDIT-TWENTY-DETAIL-P0.md` comme brief. Robert pourra brainstormer avec l'agent en SendMessage.

### Si Robert dit "on attaque Vague 11"
→ AVANT toute chose, vérifier que :
1. L'audit micro Twenty a été livré + Robert l'a validé
2. La promo prod Prospection est faite (Vague 9-10 close)
3. Les 13 questions de `08-questions-ouvertes.md` ont des réponses

Si ces 3 conditions ne sont pas remplies → ne pas attaquer, fixer d'abord.

### Si Robert dit "j'ai changé d'avis, on fait pas Twenty"
→ Pas grave. Revenir aux voies D (méta-modèle léger maison) ou C (briques génériques) du ticket original `todo/2026-05-25-vision-customisation-crm-audit-twenty.md`. Le dossier reste utile comme documentation de la décision exploratoire.

### Si Robert demande "fais-moi un mémo où on en est"
→ Lis ce CLAUDE.md + lis `00-VISION.md` + lis `AUDIT-TWENTY-DETAIL-P0.md`. Ces 3 fichiers donnent l'état complet en ~10 min.

## Liens utiles cross-app

- `../veridian-prospection/todo/2026-05-25-vision-customisation-crm-audit-twenty.md` — audit macro 6 voies
- `../veridian-prospection/todo/2026-05-25-twenty-licence-rebrand-EE-research.md` — verdict licence
- `./00-VISION.md` — vision produit finale (Robert's decisions verrouillées)
- `./AUDIT-TWENTY-DETAIL-P0.md` — TODO audit micro 30+ questions (à spawner)
- Repo cible à fork : https://github.com/twentyhq/twenty
- Doc Twenty : https://docs.twenty.com

## Quand ce dossier devient un vrai repo

Le jour où Robert dit "GO Vague 11" :

1. Soit on **fork twentyhq/twenty** dans GitHub → on clone le fork ici → les 11 .md actuels deviennent `docs/spec/` à l'intérieur du repo
2. Soit on **garde les .md comme spec dossier** et on clone le fork à côté (`veridian-crm-source/` ?) — moins probable, on préfère 1 repo unique

Mais en attendant, **ce dossier n'est PAS un repo git** — pas d'init, pas de remote. Juste des fichiers markdown commités dans `veridian-prospection/` parce que c'est là qu'on bossait.

⚠️ Note : actuellement ces fichiers sont commités dans `veridian-prospection` repo (oups). À sortir du repo Prospection et soit :
- Mettre dans `veridian-infra/docs/future-crm/` (docs cross-app)
- OU créer un repo dédié `Christ-Roy/veridian-crm` vide pour l'instant et y mettre ces .md
- OU laisser ici (sans git init) en tant que dossier de travail local
