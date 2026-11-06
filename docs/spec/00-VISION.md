# [VERIDIAN CRM] Vision produit — fork Twenty CE rebrandé Veridian

> **Type** : Vision produit + plan giga-sprint
> **Sévérité** : 🔴 P0 — nouveau produit Veridian, prochaine vague majeure après promo prod Vague 9+10 Prospection
> **Owner** : Robert (décideur business) + team-lead agents (orchestration)
> **Créé** : 2026-05-25 par team-lead après brainstorm Robert
> **Tickets connexes** :
> - `todo/2026-05-25-vision-customisation-crm-audit-twenty.md` (1er audit, 6 voies)
> - `todo/2026-05-25-twenty-licence-rebrand-EE-research.md` (verdict licence AGPLv3)

---

## 1. Décisions Robert verrouillées 2026-05-25

| Sujet | Décision |
|---|---|
| **Produit** | Nouveau produit séparé `veridian-crm`, pas extension Prospection |
| **Codebase** | Fork de `twentyhq/twenty` (AGPLv3) + rebrand Veridian complet |
| **Licence** | AGPLv3 acceptée — code public, modifications publiées open-source |
| **Positionnement commercial** | Mix Consulting high-ticket (2-5k€ setup + 200€/mois maintenance) + Vertical FR avec data 996K en option |
| **Architecture cross-app** | CRM consomme **Prospection comme API** (leads qualifiés on-demand) + **Notifuse** pour les campagnes mail propres (sender qualifié) |
| **Migration Prospection** | Progressive — on déshabille Prospection des features doublonnes UNIQUEMENT quand le CRM rebrandé porte ses propres équivalents en interne. Pas de big bang. |
| **MVP cible** | Minimum viable : Twenty CE forké + rebrand + auth Hub + 1 client consulting validé |
| **Timeline cible** | ~1.5-2 mois pour le MVP (en giga-sprint avec agents Opus parallèles) |

## 2. Positionnement marketing

**Pitch type** :
> "Veridian CRM est un CRM 100% customisable sous-couche Twenty, hébergé en France, intégré nativement avec :
> - Veridian Prospection (les 996K entreprises FR pré-enrichies pour générer des leads qualifiés à la demande)
> - Veridian Notifuse (envoi de campagnes mail au nom de votre commercial, délivrabilité maximale)
> - Veridian Hub (compte unique, billing centralisé, SSO)
>
> Pas de paywall sur les custom fields, illimité partout. Vous payez la valeur, pas la complexité."

**Concurrents directs** :
- Twenty SaaS (twenty.com) — 30€/user/mois, hosting US/EU, aucune intégration lead gen FR
- HubSpot — paywall sur tout, cher
- Pipedrive — pas méta-modèle, pas customisable
- Salesforce — usine à gaz, hors-budget PME FR

**Différenciateur unique** :
1. CRM méta-modèle ouvert (= Twenty)
2. + Data 996K leads FR pré-enrichis intégrée (← personne d'autre fait ça)
3. + Service consulting en option (setup custom client, paie ton sprint)
4. + Hosting France (RGPD propre)
5. + Stack Veridian unifiée (1 login, 1 facture, 1 portail)

## 3. Architecture cross-app cible

```
                    ┌────────────────────────────────┐
                    │ Veridian Hub (auth + billing) │
                    │ veridian.site                  │
                    └──────────┬─────────────────────┘
                               │ HMAC
            ┌──────────────────┼────────────────────┐
            │                  │                    │
   ┌────────▼──────┐  ┌────────▼──────────┐  ┌──────▼─────────┐
   │ Prospection   │  │ Veridian CRM      │  │ Notifuse       │
   │ prospection.. │  │ crm.app.veridian. │  │ notifuse..     │
   │ (cold + data) │  │ (méta-modèle)     │  │ (mail propre)  │
   └────────┬──────┘  └─────┬─────────────┘  └──────┬─────────┘
            │               │ HMAC pull leads        │
            │ ◄─────────────┤ HMAC push campagne ───►│
            │               │                        │
            └───────────────┴────────────────────────┘
                            │
                            │ Hub-orchestrated
                            ▼
                  ┌─────────────────────┐
                  │ Workspace tenant    │
                  │ (Postgres séparé /  │
                  │  méta-modèle Twenty)│
                  └─────────────────────┘
```

## 4. Pourquoi Twenty fork (AGPLv3)

| Avantage | Détail |
|---|---|
| Méta-modèle déjà fonctionnel | 3 ans de dev Twenty, qu'on ne refait pas |
| UI builder Twenty existant | Drag-drop Object/Field, vues kanban/tableau |
| GraphQL recomputed | Pas à coder le moteur |
| Workflows Twenty | Si on prend EE-like features, on bénéficie |
| 46.5k ⭐ — communauté active | Mises à jour upstream gratuites |

| Inconvénient | Mitigation |
|---|---|
| Codebase 100k+ lignes TS/NestJS | On apprend progressivement, on touche minimum |
| Dépendance roadmap Twenty | Fork = on peut diverger si nécessaire |
| Stack NestJS différente Veridian (Next.js) | On garde Next.js pour Hub/Notifuse/Prospection. CRM = NestJS (1 stack en plus, acceptable) |
| AGPLv3 = code public | Accepté par Robert (moat = data + service, pas code) |
| Interdiction trademark "Twenty" | Rebrand strict Veridian (logo, nom, couleurs, marketing) |

## 5. Décisions techniques clés (à raffiner dans 01-archi-meta-modele.md)

- **Repo** : nouveau repo GitHub `Christ-Roy/veridian-crm` (fork de twentyhq/twenty)
- **Branche staging** : `staging` (cohérent avec polyrepo Veridian)
- **URL prod** : `crm.app.veridian.site`
- **URL staging** : `crm.staging.veridian.site`
- **DB** : Postgres dédié `veridian-crm-db` (compose Dokploy séparé)
- **Auth** : custom intégration Hub (replace Twenty native auth)
- **Billing** : via Hub HMAC (replace Twenty native billing)
- **Email** : Notifuse pour transactional (replace Twenty native SMTP)
- **Storage fichiers** : R2 Cloudflare (replace Twenty native S3)
- **Stack** : NestJS + Postgres + Redis + BullMQ (stack Twenty native, on ne touche pas)

## 6. Pré-requis avant attaque Vague 11+

- [ ] Vague 9 Prospection promo prod réussie (sinon on ne touche pas au CRM)
- [ ] Vague 10 giga-test E2E hard-core verte (validation finale Prospection)
- [ ] Budget audit légal AGPL 500-1000€ envisagé (recommandé par agent recherche)
- [ ] Décision Robert sur les sous-fichiers de ce dossier (00-VISION ✓ + 01..08)
- [ ] Robert utilise lui-même Twenty SaaS officiel pendant 1 semaine pour valider l'UX avant qu'on fork (optionnel mais recommandé)

## 7. Sous-fichiers de ce dossier

| Fichier | Contenu |
|---|---|
| `00-VISION.md` | ⬅ Ce fichier (vision + décisions Robert) |
| `01-archi-meta-modele.md` | Modèle DB Twenty + spécificités Veridian |
| `02-rebrand-checklist.md` | Tout ce qu'il faut rebrand (logo, nom, couleurs, copy, emails, etc.) |
| `03-integration-hub-auth.md` | Remplacer Twenty native auth par HMAC Hub Veridian |
| `04-module-leads-b2b.md` | Pull leads qualifiés depuis Prospection vers le CRM |
| `05-module-notifuse-mail.md` | Push campagnes depuis le CRM vers Notifuse |
| `06-deploiement-infra.md` | crm.staging.veridian.site + crm.app.veridian.site (Dokploy compose) |
| `07-sprint-decomposition.md` | Découpe en N agents Opus parallèles + ordre des chantiers |
| `08-questions-ouvertes.md` | Ce qu'il reste à trancher avec Robert avant attaque |

## 8. Questions ouvertes (top 3)

1. **Quand on attaque ?** Avant ou après promo prod Vague 9-10 Prospection ?
2. **1 ou 2 clients consulting** identifiés pour validation ? (sinon on prend Robert lui-même comme 1er user)
3. **Plan SaaS pour vente non-consulting** (à terme) : 49€/user/mois ? 99€/workspace ? ou per-feature ?

## 9. Prochaines étapes

Après validation Robert de cette vision :
- Team-lead écrit les fichiers 01..08 du dossier
- Robert lit + arbitre les choix techniques
- Si vert : décomposition en agents Opus pour Vague 11 giga-sprint
