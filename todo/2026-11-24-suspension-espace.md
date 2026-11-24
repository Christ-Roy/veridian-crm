# Suspension d'un espace (CONTRAT-HUB §5.4), après le correctif VER-245

Routes signées `POST /api/tenants/suspend` et `/resume`, idempotentes, `health` rend `suspended`.

- Natif AGPL : `workspaceService.suspendWorkspace` / `reactivateWorkspace`, `activationStatus=SUSPENDED` refuse `/graphql`,
  `/metadata` (hors `@AllowSuspendedWorkspace`, 49), REST, MCP, routes d'app ; crons d'app et d'agent filtrés sur ACTIVE.
- **Piège, données perdues** : le cron natif `CleanSuspendedWorkspacesJob` prévient à 7 jours, efface en douceur à 14 et détruit
  à 21. Il lit `suspendedAt` et passe s'il est vide : la suspension Veridian ne le remplit pas (date dans le lien tenant), et une
  spec le garde avec le vrai service.
- À faire : message et écran (le front renvoie vers Settings > Billing, coupé chez nous ; « Choose a plan » à remplacer),
  webhooks sortants et synchronisations mail/agenda à éprouver, rebond du Hub (423 `workspace_suspended`, §5.21).
- Preuve : espace jetable du staging, aller, retour, données comparées, espace témoin non touché.
- À trancher par la parente : le contrat ne bloque que l'écriture, sa demande bloque aussi la lecture.
