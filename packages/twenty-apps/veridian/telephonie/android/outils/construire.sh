#!/usr/bin/env bash
# Construit l'APK signé, sur le bastion (jamais sur mail, le poste de Robert) :
#   outils/construire.sh            # tests du contrat, puis app/build/outputs/apk/release/app-release.apk
# Prérequis : JDK 17+, SDK Android (ANDROID_HOME) avec platforms;android-36, ndk;28.2.13676358, cmake;3.22.1.
# GRADLE_ARGS : options de Gradle en plus (la CI borne la mémoire : runner plafonné à 3 Go).
# Clé de signature : hors dépôt, dans $SIGNATURE_DIR (créée au premier passage, jamais affichée).
set -euo pipefail
ICI="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ICI"
WHISPER_COMMIT=d2c6f05a  # whisper.cpp 1.9.5 avec la cible parakeet, celui du Pixel (Termux) le 12/11/2026
SIGNATURE_DIR="${SIGNATURE_DIR:-$HOME/credentials/android}"
: "${ANDROID_HOME:?ANDROID_HOME manquant}"

# 1. whisper.cpp au commit épinglé (dépendance de construction, pas dans le dépôt)
if [ ! -d build-deps/whisper.cpp/.git ]; then
  git clone -q https://github.com/ggml-org/whisper.cpp build-deps/whisper.cpp
fi
git -C build-deps/whisper.cpp fetch -q origin
git -C build-deps/whisper.cpp checkout -q --detach "$WHISPER_COMMIT"
echo "sdk.dir=$ANDROID_HOME" > local.properties

# 2. clé de signature (une fois), droits 600
mkdir -p "$SIGNATURE_DIR"; chmod 700 "$SIGNATURE_DIR"
PROPRIETES="$SIGNATURE_DIR/telephonie-crm.properties"
if [ ! -f "$PROPRIETES" ]; then
  MDP="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  keytool -genkeypair -keystore "$SIGNATURE_DIR/telephonie-crm.jks" -storetype PKCS12 -alias telephonie-crm \
    -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Veridian Telephonie CRM, O=Veridian, C=FR" \
    -storepass "$MDP" -keypass "$MDP" >/dev/null 2>&1
  umask 077
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=telephonie-crm\nkeyPassword=%s\n' \
    "$SIGNATURE_DIR/telephonie-crm.jks" "$MDP" "$MDP" > "$PROPRIETES"
  chmod 600 "$PROPRIETES" "$SIGNATURE_DIR/telephonie-crm.jks"
  echo "clé de signature créée dans $SIGNATURE_DIR"
fi

# 3. fixtures du contrat à jour avec le Python de référence, tests, APK
python3 outils/fixtures_contrat.py --verifier
./gradlew -q ${GRADLE_ARGS:-} -p contrat test
export TELEPHONIE_SIGNATURE="$PROPRIETES"
export TELEPHONIE_VERSION="${TELEPHONIE_VERSION:-$(git log -1 --format=%cd-%h --date=format:%Y%m%d.%H%M 2>/dev/null || echo dev)}"
export TELEPHONIE_VERSION_CODE="${TELEPHONIE_VERSION_CODE:-$(date +%y%m%d%H)}"
nice -n 10 ./gradlew -q --console=plain ${GRADLE_ARGS:-} :app:assembleRelease
APK=app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs "$APK" | grep -E "Signer #1 certificate SHA-256" || {
  echo "APK non signé" >&2; exit 1; }
sha256sum "$APK"
ls -la "$APK"
