#!/usr/bin/env bash
# mutations-retrait-acces.sh — éprouve ce qu'un membre retiré tenait ouvert (vrai cache, deux processus, temps réel).
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

SERVICE=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/utils/settle-core-entity-cache.util.ts
M=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-member-access.service.ts
S=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service.ts
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'retrait-acces|retrait-membre' >"$TMP/jest.log" 2>&1)
}
jouer || { tail -40 "$TMP/jest.log"; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" "$TMP/sauve"
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp "$TMP/sauve" "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"
    rate=1
  elif grep -q 'Test suite failed to run' "$TMP/jest.log"; then
    cp "$TMP/sauve" "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom"
  fi
  cp "$TMP/sauve" "$fichier"
}

saboter "lecture en vol : cache vidé une seule fois" "$SERVICE" "    await coreEntityCacheService.invalidate(cacheKeyName, entityId);" ""
saboter "réponse avant l'oubli des mémoires" "$SERVICE" "  await setTimeout(MEMOIZER_TTL_MS);" ""
saboter "premier vidage oublié" "$M" "      await this.coreEntityCacheService.invalidate('userWorkspaceEntity', id);" ""
saboter "caches non attendus" "$M" "    await settleCoreEntityCache(
      this.coreEntityCacheService,
      'userWorkspaceEntity',
      membershipIds,
    );" ""
saboter "sessions de tous ses espaces coupées" "$M" "        userId,
        workspaceId,
        reason:" "        userId,
        reason:"
saboter "rafraîchissement laissé" "$M" "      await this.revokeRefreshTokens(userId, workspaceId);" ""
saboter "rafraîchissement : motif oublié" "$M" "|| jsonb_build_object('revokedReason', :revokedReason::text)" ""
saboter "rafraîchissement de tous ses espaces" "$M" "        userId,
        workspaceId,
        type:" "        userId,
        type:"
saboter "flux laissé" "$M" "      await this.closeStreams(userId, workspaceId);
    }

    await settle" "    }

    await settle"
saboter "flux ouvert entre-temps laissé" "$M" "    for (const workspaceId of workspaceIds) {
      await this.closeStreams(userId, workspaceId);
    }" ""
saboter "flux des autres coupés" "$M" "stream?.authContext.userId === userId" "stream"
saboter "retrait sans fermeture" "$S" "      await this.veridianHubMemberAccessService.close(
        user.id,
        await this.userWorkspaceRepository.find({
          where: { userId: user.id, workspaceId },
          withDeleted: true,
        }),
      );" ""
saboter "compte coupé sans fermeture" "$S" "    await this.veridianHubMemberAccessService.close(userId, memberships);" ""

[ "$rate" -eq 0 ] && echo "CONFORME"
exit "$rate"
