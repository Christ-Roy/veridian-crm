# 08 — Questions ouvertes pour Robert

> Questions à trancher avec Robert AVANT d'attaquer la Vague 11. Cumul cross-fichiers du dossier.

## Stratégie & business

1. **Quand on attaque ?**
   - Option A : Immédiatement après promo prod Vague 9 + 10 Prospection (continuité de session)
   - Option B : Pause 1-4 semaines pour consolider Prospection en prod, observer les premiers users
   - Option C : Pause indéfinie, on stocke le dossier, on attaque quand 1 prospect concret se manifeste

2. **Prospects pour Vague 11.5 (1er client consulting) ?**
   - Robert a-t-il 2-3 contacts dans son réseau qui voudraient un CRM custom ?
   - Si non, on prend Robert lui-même comme 1er user (auto-validation)

3. **Plan SaaS à terme** ?
   - 49€/user/mois (concurrence directe Twenty SaaS) ?
   - 99€/workspace + N users (pricing Veridian classique) ?
   - Per-feature gating (custom objects free / workflows business / etc.) ?
   - Décision à différer après MVP — voir ce que les clients consulting payent réellement

4. **Marque "Veridian CRM" vs autre nom** ?
   - Veridian CRM = cohérent avec stack actuelle
   - Risque : "Veridian" devient mot fourre-tout (Hub + Prospection + Notifuse + Analytics + CMS + CRM = 6 produits = confus)
   - Alternative : nom dédié (ex : "Prismo", "Atlas", "Folio") avec mention "by Veridian"
   - À trancher tôt, ça pilote le rebrand

## Technique

5. **Audit légal AGPL** ?
   - 500-1000€ recommandé par agent recherche
   - Vraiment nécessaire ou on accepte le risque solo + transparence open-source ?
   - Si on consulte un avocat, on a son contact ou on cherche ?

6. **Stack NestJS acceptée** ?
   - Twenty = NestJS + React (pas Next.js)
   - Veridian Hub/Prospection/Notifuse/Analytics/CMS = Next.js + Prisma
   - Robert OK pour gérer 2 stacks ?

7. **Hébergement Twenty self-hosted vs Twenty SaaS officiel** ?
   - Si Robert veut tester l'UX Twenty 1 semaine avant fork, créer un compte sur twenty.com (gratuit 14 jours)
   - Ça permet de comprendre le produit avant de forker

8. **Module "Leads B2B FR" est-il prioritaire dès le MVP** ?
   - Le ticket 04 le pose comme différenciateur produit
   - Mais ça ajoute ~1.5 semaine de dev à la Vague 11
   - Alternative : MVP minimal sans ce module, on l'ajoute en Vague 11.5 si un client le demande

## Opérationnel

9. **Premier essai = Robert utilise le CRM rebrandé en interne** ?
   - Décision déjà prise (Robert : "on déshabille Prospection uniquement quand en interne on aura migré")
   - Implique : Robert teste le CRM rebrandé pour SA propre prospection commerciale Veridian d'abord
   - Quel scope minimum pour ça ? Juste Objects + Fields + Vues, ou il faut aussi les Workflows ?

10. **Comment on migre Prospection → CRM progressivement** ?
    - Quelles features Prospection sont les premières à passer dans le CRM ?
      - Pipeline configurable → existe déjà côté Prospection, OK à porter
      - Fiche 360° → existe, à porter
      - Refill ICP → existe (W7b), à porter via module veridian-leads
      - Templates mail → existe (W9c), à porter
      - Inbox global → existe (W8c), à porter
      - IMAP réception → existe (W8b), à porter
    - Calendrier de migration : 6 mois ? 1 an ?

## Branding

11. **Nom de marque définitif** ?
    - "Veridian CRM" (consensus current)
    - Autre option à explorer ?

12. **Logo + couleurs** ?
    - Reprise du logo Veridian existant ? Variante ?
    - Palette OKLCH Veridian Prospection (orange #FF6B35) ou nouveau ?

13. **Slogan marketing** ?
    - Proposition : "Le CRM des PME FR — méta-modèle ouvert + 996K leads inclus"
    - Variante ? À tester avec prospects ?

## Si tu valides ces réponses, on peut attaquer la Vague 11 sereinement.

Robert peut répondre à ces questions dans ce fichier directement, ou en chat. Aucune urgence : ce dossier est une boîte de réception à digérer quand on est prêts.
