#!/usr/bin/env bash
# mutations-webhook-champs.sh — éprouve webhook-champs-lisibles.veridian.spec.ts : retire chaque maillon du filtrage des
# webhooks par le rôle (repris de l'amont 12e8fae471) ; la spec doit casser à chaque fois.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

S=packages/twenty-server/src/engine
J=$S/metadata-modules/webhook/jobs/call-webhook-jobs.job.ts
F=$S/permissions/combine/utils/filter-readable-events.util.ts
O=$S/permissions/masking/utils/omit-restricted-fields-from-event.util.ts
H=$S/permissions/masking/utils/is-update-of-hidden-fields-only.util.ts

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'webhook-champs-lisibles' >/tmp/mutation-webhook-champs.log 2>&1)
}

jouer || { tail -60 /tmp/mutation-webhook-champs.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-webhook-champs.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp /tmp/mutation-webhook-champs.sauve "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' /tmp/mutation-webhook-champs.log; then
    cp /tmp/mutation-webhook-champs.sauve "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom ($(grep -cE '^\s+●' /tmp/mutation-webhook-champs.log) signalements)"
  fi
  cp /tmp/mutation-webhook-champs.sauve "$fichier"
}

saboter "le job envoie les événements bruts" "$J" "events: await readableEvents," "events: workspaceEventBatch.events,"
saboter "le job ne passe plus par findReadableEvents" "$J" "this.permissionsService.findReadableEvents({" "this.permissionsService.findReadableEventRecordIds({"
saboter "le job n'identifie plus le webhook" "$J" "type: 'webhook'," "type: 'application',"
saboter "enregistrements illisibles envoyés" "$F" ".filter((event) => readableRecordIds.has(event.recordId))" ".filter(() => true)"
saboter "champs interdits non retirés" "$F" "omitRestrictedFieldsFromEvent({" "((args: { event: TEvent }) => args.event)({"
saboter "mise à jour de champs cachés envoyée" "$F" ".filter((event) => !isUpdateOfHiddenFieldsOnly(event))" ""
saboter "mise à jour de champs cachés jamais reconnue" "$H" "updatedFields.length === 0" "false"
saboter "aucun champ n'est jamais restreint" "$O" "if (restrictedFieldNames.size === 0) {" "if (true) {"
saboter "champ restreint gardé dans le contenu" "$O" "isFieldNameKept: (fieldName) => !restrictedFieldNames.has(fieldName)," "isFieldNameKept: () => true,"
saboter "canRead faux ignoré" "$O" "if (permissions.canRead !== false) {" "if (true) {"

[ "$rate" -eq 0 ] && { echo "CONFORME : chaque maillon du filtrage des champs des webhooks est vu échouer"; exit 0; }
exit 1
