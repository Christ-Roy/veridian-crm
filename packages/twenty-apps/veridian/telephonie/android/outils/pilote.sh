#!/usr/bin/env bash
# Pose la version d'essai sur un téléphone joignable par adb, sans rien perdre, et le prouve. Rejouable.
#   outils/pilote.sh --serial <adresse adb> --apk telephonie-crm-<code>.apk [--manifeste fichier.json] [--sauvegarde dossier]
# Le téléphone est toujours désigné : aucune valeur par défaut, jamais de `adb connect` ici.
# Étapes : 1 version en place plus ancienne et même certificat · 2 empreinte de l'APK = manifeste du canal d'essai
# · 3 etat.json sauvegardé · 4 install -r · 5 canal essai + droit d'installer · 6 service vivant, état comparé.
# Sortie : 0 tout est prouvé · 1 une preuve a échoué (rien n'est annulé, l'état avant est dans la sauvegarde) · 2 non abouti.
set -uo pipefail
PAQUET=site.veridian.telephonie
EXT="/sdcard/Android/data/$PAQUET/files"
SERIE=""; APK=""; MANIFESTE=""; SAUVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --serial) SERIE="$2"; shift 2 ;;
    --apk) APK="$2"; shift 2 ;;
    --manifeste) MANIFESTE="$2"; shift 2 ;;
    --sauvegarde) SAUVE="$2"; shift 2 ;;
    *) echo "option inconnue : $1" >&2; exit 2 ;;
  esac
done
[ -n "$SERIE" ] && [ -f "$APK" ] || { echo "usage : pilote.sh --serial <adb> --apk <fichier.apk> [--manifeste f] [--sauvegarde d]" >&2; exit 2; }
SDK="${ANDROID_HOME:-$HOME/android-sdk}"
ADB() { timeout 120 adb -s "$SERIE" "$@"; }
sh_() { ADB shell "$@" | tr -d '\r'; }
echec() { echo "ECHEC : $*" >&2; exit 1; }
nonabouti() { echo "NON ABOUTI : $*" >&2; exit 2; }
json() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2"; }

[ "$(ADB get-state 2>/dev/null | tr -d '\r')" = device ] || nonabouti "téléphone $SERIE injoignable par adb"
APKBIN=$(ls -d "$SDK"/build-tools/*/ 2>/dev/null | sort -V | tail -1)
[ -x "${APKBIN}apksigner" ] && [ -x "${APKBIN}aapt2" ] || nonabouti "build-tools Android absents de $SDK"
SAUVE="${SAUVE:-$(mktemp -d)}"; mkdir -p "$SAUVE"

# 1. version en place plus ancienne, même certificat
INSTALLE=$(sh_ dumpsys package $PAQUET | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1)
[ -n "$INSTALLE" ] || nonabouti "l'app n'est pas installée sur $SERIE"
NEUF=$("${APKBIN}aapt2" dump badging "$APK" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
[ -n "$NEUF" ] || nonabouti "versionCode de l'APK illisible"
[ "$NEUF" -gt "$INSTALLE" ] || echec "l'APK ($NEUF) n'est pas plus récent que la version en place ($INSTALLE)"
ADB pull "$(sh_ pm path $PAQUET | head -1 | cut -d: -f2)" "$SAUVE/en-place.apk" >/dev/null || nonabouti "APK en place non récupéré"
cert() { "${APKBIN}apksigner" verify --print-certs "$1" 2>/dev/null | sed -n 's/.*Signer #1 certificate SHA-256 digest: //p'; }
CA=$(cert "$SAUVE/en-place.apk"); CN=$(cert "$APK")
[ -n "$CA" ] && [ -n "$CN" ] || nonabouti "certificat illisible"
[ "$CA" = "$CN" ] || echec "certificat différent (en place $CA, APK $CN)"
echo "1. en place $INSTALLE < $NEUF, même certificat ${CA:0:16}…"

# 2. empreinte contre le manifeste du canal d'essai
if [ -z "$MANIFESTE" ]; then
  MANIFESTE="$SAUVE/manifeste.json"
  curl -fsSL --max-time 30 https://github.com/Christ-Roy/veridian-crm/releases/download/telephonie-android-essai/manifeste.json -o "$MANIFESTE" \
    || nonabouti "manifeste du canal d'essai non lu"
fi
SHA=$(sha256sum "$APK" | cut -d' ' -f1)
[ "$(json "$MANIFESTE" "d['sha256']")" = "$SHA" ] || echec "sha256 de l'APK différent de celui du manifeste"
[ "$(json "$MANIFESTE" "d['versionCode']")" = "$NEUF" ] || echec "versionCode du manifeste différent de celui de l'APK"
[ "$(json "$MANIFESTE" "d['suspendu']")" = False ] || echec "canal suspendu"
echo "2. sha256 $SHA conforme au manifeste (versionCode $NEUF)"

# 3. état avant
commande() { sh_ am broadcast -a $PAQUET.COMMANDE -n $PAQUET/.Commandes --es c "$@"; }
commande etat >/dev/null
ADB pull "$EXT/etat.json" "$SAUVE/etat-avant.json" >/dev/null || nonabouti "etat.json illisible avant (service arrêté ?)"
AVANT_MODE=$(json "$SAUVE/etat-avant.json" "d['reglages']['mode']")
AVANT_ACCES=$(json "$SAUVE/etat-avant.json" "d['reglages']['acces']")
AVANT_FILE=$(json "$SAUVE/etat-avant.json" "d['file']")
AVANT_SYNCHRO=$(json "$SAUVE/etat-avant.json" "d['synchro']")
AVANT_SCHEMA=$(json "$SAUVE/etat-avant.json" "d['reglages']['schema']")
AVANT_CLE=$(json "$SAUVE/etat-avant.json" "d['reglages'].get('cle_sha256_12')")
echo "3. avant : mode=$AVANT_MODE acces=$AVANT_ACCES schema=$AVANT_SCHEMA file=$AVANT_FILE synchro=$AVANT_SYNCHRO (sauvegarde $SAUVE/etat-avant.json)"

# 4. installation par-dessus : les données sont gardées, aucune autorisation n'est redemandée
SORTIE=$(timeout 300 adb -s "$SERIE" install -r "$APK" 2>&1 | tail -1)
[ "$SORTIE" = Success ] || echec "adb install -r : $SORTIE"
echo "4. install -r : $SORTIE"

# 5. canal d'essai et droit d'installer
sh_ appops set $PAQUET REQUEST_INSTALL_PACKAGES allow >/dev/null
[ "$(sh_ appops get $PAQUET REQUEST_INSTALL_PACKAGES)" = "REQUEST_INSTALL_PACKAGES: allow" ] || echec "autorisation d'installer non posée"
sh_ am broadcast -a $PAQUET.COMMANDE -n $PAQUET/.Commandes --es c demarrer >/dev/null
# l'app vient d'être remplacée : on attend que le service réponde
for _ in $(seq 1 30); do
  R=$(commande canal --es valeur essai) && case "$R" in *"canal "*) break ;; esac
  sleep 2
done
case "$R" in *"→ essai"*|*"essai → essai"*) ;; *) echec "commande canal : $R" ;; esac
echo "5. $(echo "$R" | sed -n 's/.*data="\(.*\)"/\1/p'), REQUEST_INSTALL_PACKAGES allow"

# 6. service vivant et état comparé
APRES="$SAUVE/etat-apres.json"; OK=0
for _ in $(seq 1 60); do
  commande etat >/dev/null
  if ADB pull "$EXT/etat.json" "$APRES" >/dev/null 2>&1 && [ "$(json "$APRES" "d['version'] != '$(json "$SAUVE/etat-avant.json" "d['version']")'")" = True ]; then OK=1; break; fi
  sleep 3
done
[ "$OK" = 1 ] || nonabouti "le service n'a pas rendu d'état de la nouvelle version en 3 min"
[ -n "$(sh_ pidof $PAQUET)" ] || echec "processus de l'app absent"
[ "$(sh_ dumpsys activity services $PAQUET | grep -c ServiceSynchro)" -ge 1 ] || echec "ServiceSynchro absent"
ECHECS=""
cmp_() { [ "$2" = "$3" ] || ECHECS="$ECHECS\n  $1 : avant $2, après $3"; }
cmp_ mode "$AVANT_MODE" "$(json "$APRES" "d['reglages']['mode']")"
cmp_ acces "$AVANT_ACCES" "$(json "$APRES" "d['reglages']['acces']")"
cmp_ schema "$AVANT_SCHEMA" "$(json "$APRES" "d['reglages']['schema']")"
cmp_ empreinte_cle "$AVANT_CLE" "$(json "$APRES" "d['reglages'].get('cle_sha256_12')")"
cmp_ canal essai "$(json "$APRES" "d['reglages']['canal_maj']")"
[ "$(json "$APRES" "d['reglages']['crm']")" = True ] || ECHECS="$ECHECS\n  accès au CRM non configuré après la mise à jour"
[ "$(json "$APRES" "d['reglages'].get('reconnexion')")" = None ] || ECHECS="$ECHECS\n  reconnexion demandée"
[ "$(json "$APRES" "d['synchro'] >= $AVANT_SYNCHRO")" = True ] || ECHECS="$ECHECS\n  synchro : $AVANT_SYNCHRO empreintes avant, $(json "$APRES" "d['synchro']") après"
# la file ne perd rien : elle ne grossit pas d'elle-même et se vide ; une file vidée sans envoi se voit dans synchro
APRES_PREP=$(json "$APRES" "d['preparation']")
[ "$APRES_PREP" = PRET ] || [ "$APRES_PREP" = INCONNU ] || ECHECS="$ECHECS\n  préparation du CRM : $APRES_PREP (attendu PRET)"
echo "6. après : $(json "$APRES" "d['version']") mode=$(json "$APRES" "d['reglages']['mode']") acces=$(json "$APRES" "d['reglages']['acces']") file=$(json "$APRES" "d['file']") synchro=$(json "$APRES" "d['synchro']") préparation=$APRES_PREP maj=$(json "$APRES" "d['mise_a_jour']")"
if [ -n "$ECHECS" ]; then printf 'ECHEC : écarts avant/après :%b\n' "$ECHECS" >&2; exit 1; fi
echo "OK : version $NEUF posée, canal essai, rien perdu (mode, accès, schéma, clé, synchro), service vivant"
