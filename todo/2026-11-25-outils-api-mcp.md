# Outils MCP `api_lire`, `api_ecrire`, `api_supprimer`

Demande de Robert relayée par le Hub (25/11/2026, « il faut sans doute du cli un peu partout […] une limitation du mcp »),
découpage de la parente. À faire après Liaisons à la demande pour toutes les organisations (clic « Listed » de Robert).

| Outil | Fait | Annotation |
|---|---|---|
| `api_lire` | GET `/rest/<objet>`, requête GraphQL sans mutation | `readOnlyHint: true` |
| `api_ecrire` | créer et modifier des fiches, lots compris | `readOnlyHint: false` |
| `api_supprimer` | supprimer, fusionner, détruire | `destructiveHint: true` |

- Exécutés dans le serveur avec l'identité du membre, jamais une clé. Espace du jeton seul, droits de rôle de l'écran.
- Classement par analyse de l'opération (AST GraphQL : toutes les opérations et champs racine du document), jamais par le nom
  donné ; méthode et chemin REST en liste blanche. Une suppression passée à `api_ecrire` est refusée.
- Hors périmètre, refusé par liste blanche : membres, rôles, clés API, webhooks, apps, réglages d'espace, connexions mail,
  fichiers, `/metadata`, `/admin-panel`, introspection non bornée.
- Interdits à un jeton d'action (`act`) et à un sujet `integration:`. Taille, profondeur et nombre de lignes bornés.
- Manque au MCP par rapport au CLI : l'API brute et l'import en lot. La publication d'app reste hors MCP.
- Preuves : spec, sabotages (une mutation déguisée, un alias, un fragment, un second document), preuve staging avec un membre
  restreint (rien de plus qu'un `find_many`).
