# 02 — Rebrand Twenty → Veridian CRM (checklist exhaustive)

> Tout ce qu'il faut renommer/changer dans le fork Twenty pour qu'il devienne Veridian CRM sans aucune trace de la marque Twenty (obligation AGPLv3 + trademark).

## Branding visuel

- [ ] Logo Twenty (octogone vert) → Logo Veridian (V stylisé orange)
- [ ] Favicon : `apps/twenty-front/public/icons/favicon.svg` → svg Veridian
- [ ] OG image : remplacer toutes les images preview
- [ ] Couleurs : palette CSS dans `apps/twenty-ui/src/theme/`
  - Primary Twenty `#1A1A1A` + accent vert → Primary Veridian `#FF6B35` (orange) + accent OKLCH design system
- [ ] Tokens design : adopter les tokens OKLCH Veridian (cf `src/app/globals.css` Prospection)

## Branding textuel

- [ ] Toute occurrence "Twenty" / "twentyhq" / "twenty.com" dans :
  - `package.json` (name, repository, author, homepage)
  - README.md (titre, description, badges)
  - `apps/twenty-front/src/locales/*.json` (i18n FR + EN)
  - `apps/twenty-server/src/...` (commentaires, logs, mail templates)
  - Documentation `docs.twenty.com` → adapter pour `crm.app.veridian.site/docs`
- [ ] Email transactional templates (signup welcome, password reset, etc.) → branding Veridian + footer Veridian
- [ ] Slogan : remplacer "The #1 Open-Source CRM" par "Le CRM des PME FR — méta-modèle ouvert + 996K leads inclus"

## Branding code

- [ ] Renommer le repo : `Christ-Roy/veridian-crm` (fork de twentyhq/twenty)
- [ ] Variables `process.env.TWENTY_*` → `process.env.VERIDIAN_*` (search/replace global avec migration `.env`)
- [ ] Noms Docker : `compose-twenty-*` → `compose-veridian-crm-*`
- [ ] User-Agent HTTP : `Twenty/X.X` → `VeridianCRM/X.X`

## URL & infra

- [ ] Toutes les URL hardcodées vers `app.twenty.com` → `crm.app.veridian.site`
- [ ] Subdomain workspaces : `[workspace].twenty.com` → on garde tout dans `crm.app.veridian.site` (path-based pour la v1, subdomain plus tard)

## Mention légale AGPLv3

- [ ] Garder le fichier `LICENSE` original Twenty (AGPLv3) en tête du repo
- [ ] Ajouter `NOTICE.md` qui crédite Twenty Inc. comme upstream + version forkée
- [ ] Page `/credits` accessible publique dans l'UI : "Veridian CRM est basé sur Twenty (twentyhq/twenty) sous licence AGPLv3. Code source disponible sur github.com/Christ-Roy/veridian-crm"

## Trademark — choses à NE PAS faire

- [ ] ❌ Garder le nom "Twenty" visible nulle part (UI, code, marketing)
- [ ] ❌ Copier les screenshots officiels Twenty pour le marketing
- [ ] ❌ Dire "Twenty rebrandé" en commercial (juste : "CRM open-source forké et adapté pour Veridian")

## Estimation

~1-2 jours de travail (search/replace global + design assets + check final).

Agent dédié unique : pas besoin d'expertise Twenty profonde, juste organisation.
