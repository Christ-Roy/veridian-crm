# Rôle "Sales tunnel" — permissions natives AGPL (prêt à câbler)

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-crm (TaskList #20)
> **Créé** : 2026-06-10
> **Bloqué par** : liste des sales à inviter (décision Robert via lead) +
> arbitrage A5 "les sales voient quoi" (workspace Robert = ils voient tout
> par défaut ; le rôle ci-dessous restreint au périmètre tunnel).

## Pourquoi ce rôle (et pas de clean room RLS)

L'audit du fork a montré que les permissions par OBJET sont **AGPL natif**
(modules `role`, `object-permission`, `field-permission`, `view-permissions`,
`permissions` = 0 fichier `@license Enterprise`). Seul le filtrage par LIGNE
(RLS, `row-level-permission-predicate`) est EE. Le besoin "les sales ne voient
que le tunnel" se traite **au niveau objet**, donc nativement, légalement,
sans clean room.

Limite assumée : un sale verra TOUTES les Person (pas seulement les leads
tunnel) — séparer leads tunnel vs clients consulting au sein de `person`
serait du RLS (EE). Si Robert l'exige un jour → workspace dédié tunnel
(0 code) ou clean room RLS (backlog, critère revente).

## Design du rôle (deny-all puis allow ciblé)

Au niveau **rôle** : tout à `false` (le rôle ne donne aucun accès global).

```graphql
mutation { createOneRole(createRoleInput: {
  label: "Sales tunnel",
  description: "Accès commercial au tunnel de vente — pas de settings, pas de consulting",
  icon: "IconPhoneCall",
  canUpdateAllSettings: false,
  canAccessAllTools: false,
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canBeAssignedToUsers: true,
  canBeAssignedToAgents: false,
  canBeAssignedToApiKeys: false
}) { id } }
```

Puis **object-permissions** explicites (read + update, jamais destroy) sur les
seuls objets du tunnel — `upsertObjectPermissions(roleId, objectPermissions: [...])` :

| objet | read | update | softDelete | destroy | objectMetadataId (workspace veridian) |
|---|---|---|---|---|---|
| person | ✅ | ✅ | ❌ | ❌ | `a5321efa-4ef9-494e-b615-4fda5653b86d` |
| company | ✅ | ✅ | ❌ | ❌ | `d33583c0-039b-4190-9b33-1bbf6ac92b24` |
| opportunity | ✅ | ✅ | ❌ | ❌ | `9c01cdf8-22af-4345-8252-8faa27f0f8f4` |
| mailingBatch | ✅ | ❌ | ❌ | ❌ | `4f082510-a2fc-48f2-bfd3-a638dbf49a6b` |
| timelineActivity | ✅ | ❌ | ❌ | ❌ | (à résoudre : GET /rest/metadata/objects nameSingular=timelineActivity) |
| note + noteTarget | ✅ | ✅ | ❌ | ❌ | (idem) |
| task + taskTarget | ✅ | ✅ | ❌ | ❌ | (idem) |

**EXCLU délibérément** (le rôle n'a aucune permission dessus, donc invisible
pour le sale) :
- `prospection` (custom object consulting — `8c164b27-3a8f-4db4-94fd-3351bb694289`)
- tous les objets settings/admin (le rôle a `canUpdateAllSettings: false`)

## Invitation des sales

Une fois la liste fournie, pour chaque sale :
`sendInvitations(emails: [...], roleId: "<id-Sales-tunnel>")` (flow étape 7 du
skill admin-twenty — nécessite un USER access token, pas le Bearer API_KEY).
Le sale crée son mot de passe au clic et atterrit avec le rôle Sales tunnel.

## Statut

- ✅ Schéma GraphQL validé (createOneRole + upsertObjectPermissions + flags).
- ⏳ Création du rôle : **gelée** jusqu'à la liste sales (inutile de créer un
  rôle non assigné ; + l'arbitrage A5 peut basculer sur workspace dédié).
- Si Robert dit "go avec workspace Robert + liste X" → ~15 min : créer le rôle,
  résoudre les 3-4 objectMetadataId manquants, upsert permissions, inviter.
