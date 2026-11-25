#!/usr/bin/env bash
# mutations-api-mcp.sh : éprouve api-mcp.veridian.spec.ts (VER-253), chaque garde retirée doit la faire échouer.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
V=packages/twenty-server/src/engine/core-modules/veridian-mcp-api
C=$V/utils/check-api-operation.util.ts
R=$V/api-runner.service.ts
O=$V/utils/build-api-objects.util.ts
A=packages/twenty-server/src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tool-annotations.constant.ts
LOG=$(mktemp); SAUVE=$(mktemp); EN_COURS=""
trap '[ -n "$EN_COURS" ] && cp "$SAUVE" "$EN_COURS"; rm -f "$LOG" "$SAUVE"' EXIT
jouer() { (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'api-mcp' >"$LOG" 2>&1); }
jouer || { tail -40 "$LOG"; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"
rate=0 total=0 vus=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  total=$((total + 1)); cp "$fichier" "$SAUVE"; EN_COURS="$fichier"
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp "$SAUVE" "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' "$LOG"; then cp "$SAUVE" "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else echo "détecté : $nom"; vus=$((vus + 1)); fi
  cp "$SAUVE" "$fichier"; EN_COURS=""
}
saboter "méthode non jugée" "$C" '!METHODS[kind].has(entry.method)' 'false'
saboter "suppression dans l'écriture" "$C" "'updateOne', 'updateMany'])" "'updateOne', 'updateMany', 'deleteOne'])"
saboter "écriture dans la lecture" "$C" "'findDuplicates', 'groupBy'])" "'findDuplicates', 'groupBy', 'createOne', 'deleteOne'])"
saboter "type d'opération non jugé" "$C" "operation.operation !== (kind === 'lire' ? 'query' : 'mutation')" 'false'
saboter "objet non jugé" "$C" "!(kind === 'lire' ? object?.readable : object?.writable)" 'false'
saboter "plusieurs opérations" "$C" '|| others.length > 0' ''
saboter "fragments nommés permis" "$C" "    FragmentSpread: () => {
      reason ??= 'Fragments are not supported: write the fields out.';" "    FragmentSpread: () => {"
saboter "fragments en ligne permis" "$C" "    InlineFragment: () => {
      reason ??= 'Fragments are not supported: write the fields out.';" "    InlineFragment: () => {"
saboter "directives permises" "$C" "reason ??= 'Directives are not supported.';" ''
saboter "secrets lisibles" "$C" 'SECRET_FIELDS.has(node.name.value)' 'false'
saboter "profondeur libre" "$C" 'depth > API_LIMITS.depth' 'false'
saboter "champs racine libres" "$C" 'rootFields.length > API_LIMITS.rootFields' 'false'
saboter "taille libre" "$C" 'query.length > API_LIMITS.query ||' ''
saboter "variables libres" "$C" 'JSON.stringify(variables).length > API_LIMITS.variables' 'false'
saboter "écriture en masse par filtre" "$C" 'BULK_BY_FILTER.has(method) &&' 'false &&'
saboter "filtre mêlé accepté" "$C" 'Object.keys(others).length === 0 &&' ''
saboter "opérateur mêlé accepté" "$C" "Object.keys(id ?? {}).join() === 'in' &&" ''
saboter "liste vide acceptée" "$C" 'ids.length > 0 &&' ''
saboter "plus de 100 identifiants" "$C" 'ids.length <= API_LIMITS.ids &&' ''
saboter "lot de création libre" "$C" '|| args.data.length > API_LIMITS.ids' ''
saboter "deletedAt écrit" "$C" "kind === 'ecrire' && hasKey(args, 'deletedAt')" 'false'
saboter "variables non lues" "$C" 'extractArgumentsFromAst(field.arguments, variables)' 'extractArgumentsFromAst(field.arguments, {})'
saboter "clé ou app acceptée" "$R" "authContext.type !== 'user' ||" ''
saboter "autre espace accepté" "$R" 'authContext.workspace.id !== workspaceId' 'false'
saboter "objet lisible pris pour inscriptible" "$C" "kind === 'lire' ? object?.readable : object?.writable" 'object?.readable'
saboter "relations imbriquées non jugées" "$C" 'target === undefined || !objects.get(target)?.readable' 'target === undefined'
saboter "objets inactifs lisibles" "$O" 'getDatabaseCrudToolFlatObjects(' '((m: object) => Object.values(m) as never as FlatObjectMetadata[])('
saboter "standard lu sans liste" "$O" 'READ_ONLY_STANDARD_OBJECTS.has(flatObject.nameSingular)' 'true'
saboter "standard écrit sans liste" "$O" '? WRITABLE_STANDARD_OBJECTS.has(flatObject.nameSingular)' '? true'
saboter "membres inscriptibles" "$O" "  'noteTarget',
]);" "  'noteTarget',
  'workspaceMember',
]);"
saboter "objets système des apps inscriptibles" "$O" ': flatObject.isSystem === false' ': true'
saboter "objets des apps fermés" "$O" ': flatObject.isSystem === false' ': false'
saboter "champ caché lisible" "$C" 'object?.hidden.has(name) ||' ''
saboter "membre entier lisible" "$C" '|| object?.only?.has(name) === false' ''
saboter "membres regroupables" "$C" "object?.only && entry.method === 'groupBy'" 'false'
saboter "liens de fichiers lisibles" "$O" 'field.type === FieldMetadataType.FILES ||' ''
saboter "adresses de fichiers lisibles" "$O" "'fullPath', 'avatarUrl'" "'fullPath'"
saboter "membre sans borne" "$O" '? READABLE_FIELDS[flatObject.nameSingular]' '? undefined'
saboter "hors du contexte du membre" "$R" 'withWorkspaceAuthContext(authContext, () =>' 'withWorkspaceAuthContext({ ...authContext, type: "system" } as never, () =>'
saboter "introspection ouverte" "$R" '          false,
          true,' '          true,
          true,'
saboter "erreur native prise pour un succès" "$R" '|| result.errors?.length' ''
saboter "réponse sans plafond" "$R" 'JSON.stringify(result.data).length > API_LIMITS.result' 'false'
saboter "api_lire non déclaré en lecture" "$A" "  'api_lire'," ''
saboter "api_ecrire déclaré en lecture" "$A" "  'api_lire'," "  'api_lire', 'api_ecrire',"
saboter "api_supprimer non destructeur" "$A" "['run_workflow', 'api_supprimer']" "['run_workflow']"
echo "$vus sabotages détectés sur $total"
exit "$rate"
