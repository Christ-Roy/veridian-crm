# Activer les 3 features EE clean-room en prod (SSO / custom domains / audit logs)

> **Sévérité** : 🟡 P1 (déclenché par besoin client, pas avant)
> **Owner** : agent veridian-crm
> **Créé** : 2026-06-15

## Contexte
Les 3 modules EE réécrits clean-room AGPL (veridian-custom-domain, veridian-sso,
veridian-audit-log) sont DÉJÀ en prod dans l'image (code dormant), validés sur
staging. Mais AUCUN n'est ACTIVÉ/exercé en prod réel : pas de provider SSO
configuré, pas de custom domain déclaré, audit-log tourne en fond.

## Déclencheurs (px = quand activer)
- **SSO SAML/OIDC** → quand un 1er client entreprise a un IdP (Okta/Azure/Google
  Workspace) et exige le login SSO. Px: signature d'un client avec IdP d'entreprise.
- **Custom domains (white-label)** → quand un client exige crm.son-domaine.com.
  ⚠️ Pré-requis INFRA bloquant: catch-all Traefik + ACME (ticket veridian-infra/
  todo/2026-06-14-crm-custom-domain-traefik-catchall.md). Px: 1er client white-label payant.
- **Audit logs RGPD/SOC2** → quand un prospect/client exige une traçabilité
  compliance. Px: 1er signal compliance. ⚠️ irréversible: les events passés ne se
  rattrapent pas, donc activer TÔT si compliance attendue (le module tourne déjà,
  juste à exposer la consultation + confirmer la rétention).

## À faire au déclenchement (par feature)
Protocole éprouvé: configurer sur STAGING d'abord (provider SSO de test / custom
domain de test) → test runtime + Chrome → puis prod avec go Robert (tier 🔴 pour SSO,
touche l'auth). Flows API dans skill admin-twenty (SSO endpoints, setVeridianCustomDomain,
veridianAuditLog query). NE PAS activer "au cas où" — chaque activation = test runtime.

## Note
RLS écarté (le natif AGPL + vue Mine suffit, cf docs/spec/SPEC-RLS-CLEANROOM.md).
Billing reste OFF jusqu'à ce que le fork soit prêt (décision Robert).
