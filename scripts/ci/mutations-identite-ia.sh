#!/usr/bin/env bash
# mutations-identite-ia.sh — éprouve identite-ia.veridian.spec.ts (VER-203) : retire chaque garde de l'assertion
# d'identité des appels au modèle et exige que la spec échoue. Un sabotage non détecté fait sortir en 1.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

U=packages/twenty-server/src/engine/core-modules/veridian-ia/utils/identite-ia.util.ts
M=packages/twenty-server/src/engine/core-modules/veridian-ia/utils/identite-ia.middleware.ts
T=packages/twenty-server/src/engine/metadata-modules/ai/ai-models/utils/build-ai-telemetry.util.ts
F=packages/twenty-server/src/engine/metadata-modules/ai/ai-models/services/sdk-provider-factory.service.ts

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'veridian-ia/__tests__/identite-ia' >/tmp/mutation-ia.log 2>&1)
}

jouer || { tail -30 /tmp/mutation-ia.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-ia.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { echo "NON ABOUTI : motif absent ($nom)"; cp /tmp/mutation-ia.sauve "$fichier"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  else
    echo "détecté : $nom ($(grep -cE '^\s+●' /tmp/mutation-ia.log) signalements)"
  fi
  cp /tmp/mutation-ia.sauve "$fichier"
}

saboter "1. sans en-tête accepté" "$U" "if (!jeton) return { ok: false, raison: 'en-tête absent' };" "if (!jeton) jeton = 'a.b.c';"
saboter "2. signature non vérifiée" "$U" "!timingSafeEqual(recue, attendue)) return" "false) return"
saboter "3. expiration ignorée" "$U" "claims.exp <= maintenantS ||" "false ||"
saboter "4. workspace non comparé" "$U" "claims.workspace_id !== attendu.workspaceId) return" "false) return"
saboter "5. contexte non posé par buildAiTelemetry" "$T" "headers: encoderContexteIa(identifiers)," "headers: {},"
saboter "6. modèle non enveloppé par la fabrique" "$F" "const instance = this.withVeridianIdentity(
      providerName,
      this.buildProviderInstance(config),
    );" "const instance = this.buildProviderInstance(config);"
saboter "7. contexte interne laissé aux autres fournisseurs" "$M" "      return { ...params, headers };
    }

    const secret" "      return params;
    }

    const secret"
saboter "8. identité signée pour tout fournisseur" "$M" "  providerName === (process.env.VERIDIAN_IA_FOURNISSEUR ?? 'veridian');" "  providerName.length > 0;"

saboter "9. audience non comparée" "$U" "claims.aud !== AUDIENCE_IDENTITE_IA) return" "false) return"
saboter "10. fil non contrôlé" "$U" "!FIL_VALIDE.test(claims.fil)) return" "false) return"

[ "$rate" -eq 0 ] && { echo "CONFORME : chaque garde de l'identité IA est vue échouer"; exit 0; }
exit 1
