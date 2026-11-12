#!/usr/bin/env bash
# Installe ou met à jour l'app sur le Pixel, sans toucher à l'écran, rejouable :
#   outils/installer.sh APK [--mode miroir|ecriture] [--modele] [--acces]
#     --acces  : l'accès au CRM (url et clé du rôle Téléphone), lu sur le bastion par `outils/acces_crm.py`, sans
#                être affiché ; l'app a sa propre clé adb (acceptée une fois à l'écran, voir README).
#     --modele : copie le modèle Parakeet de Termux dans le dossier de l'app (668 Mo, sur le téléphone même).
# Accès : skill android, section Pixel (serveur adb et adresse du téléphone en variables, hors dépôt).
set -euo pipefail
APK="${1:?APK attendu}"; shift
MODE=""; MODELE=0; ACCES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --modele) MODELE=1; shift ;;
    --acces) ACCES=1; shift ;;
    *) echo "option inconnue : $1" >&2; exit 2 ;;
  esac
done
export ANDROID_ADB_SERVER_PORT="${ANDROID_ADB_SERVER_PORT:-5038}"
CIBLE="${PIXEL_ADB:?PIXEL_ADB=<adresse:port adb du téléphone> manquant}"
PAQUET=site.veridian.telephonie
EXT="/sdcard/Android/data/$PAQUET/files"
adb connect "$CIBLE" >/dev/null 2>&1 || true
sh_() { timeout 120 adb -s "$CIBLE" shell "$@"; }
commande() { sh_ am broadcast -a $PAQUET.COMMANDE -n $PAQUET/.Commandes --es c "$@" | sed -n 's/.*data="\(.*\)"/\1/p'; }

timeout 300 adb -s "$CIBLE" install -r -g "$APK" | tail -1
for p in READ_CALL_LOG READ_SMS RECEIVE_SMS RECEIVE_MMS READ_CONTACTS READ_PHONE_STATE POST_NOTIFICATIONS WRITE_SECURE_SETTINGS; do
  sh_ pm grant $PAQUET android.permission.$p
done
sh_ appops set $PAQUET MANAGE_EXTERNAL_STORAGE allow
sh_ appops set $PAQUET RUN_ANY_IN_BACKGROUND allow
sh_ appops set $PAQUET RUN_IN_BACKGROUND allow
sh_ dumpsys deviceidle whitelist +$PAQUET >/dev/null
sh_ cmd notification allow_listener $PAQUET/$PAQUET.EcouteNotifications || true
# READ_VOICEMAIL : réservée au système, le refus est attendu (la messagerie passe par le shell)
sh_ pm grant $PAQUET com.android.voicemail.permission.READ_VOICEMAIL >/dev/null 2>&1 && echo "READ_VOICEMAIL accordée ?!" || echo "READ_VOICEMAIL refusée (attendu)"
echo "démarrage : $(commande demarrer)"
sleep 3
if [ -n "$MODE" ]; then
  printf '{"mode": "%s"}' "$MODE" | sh_ "cat > $EXT/reglages.json"
fi
if [ "$ACCES" = 1 ]; then
  timeout 60 ssh "${BASTION:-contabo-storage}" 'sudo -n -u brunon5 python3 -' < "$(dirname "$0")/acces_crm.py" | sh_ "cat > $EXT/acces.json"
fi
echo "configurer : $(commande configurer)"
if [ "$MODELE" = 1 ]; then
  M=ggml-parakeet-tdt-0.6b-v3-q8_0.bin
  timeout 600 ssh pixel "mkdir -p ~/storage/shared/Download/.telephonie && cp ~/whisper.cpp/models/$M ~/storage/shared/Download/.telephonie/$M.part"
  sh_ "mkdir -p $EXT/modeles && mv /sdcard/Download/.telephonie/$M.part $EXT/modeles/$M && rmdir /sdcard/Download/.telephonie"
  echo "modèle : $(sh_ sha256sum $EXT/modeles/$M | cut -c1-16)… / Termux : $(timeout 120 ssh pixel sha256sum ~/whisper.cpp/models/$M | cut -c1-16)…"
fi
echo "état : $(commande etat)"
