#!/usr/bin/env bash
# capture-sortante.sh — recense ce qu'un conteneur envoie vers l'extérieur.
#
# Écoute eth0 dans l'espace réseau du conteneur cible (sur le groupe Nomad,
# toutes les tâches partagent cet espace) : requêtes DNS, SNI TLS, connexions
# vers une IP publique. Le trafic privé (RFC1918, CGNAT Tailscale) est ignoré.
#
# Un témoin (curl vers example.org) part pendant la capture : s'il n'est pas vu,
# l'instrument est aveugle et le verdict est NON ABOUTI, jamais « silence ».
#
# Usage : capture-sortante.sh <conteneur> <secondes> [fichier-liste-autorisee]
#   liste autorisée : un nom d'hôte par ligne (suffixe accepté), # = commentaire
# Sortie : 0 silence · 1 envoi détecté · 2 mesure non aboutie

set -uo pipefail

CIBLE="${1:?conteneur cible}"
DUREE="${2:?durée en secondes}"
AUTORISES="${3:-/dev/null}"
IMAGE="nicolaka/netshoot:v0.13"
TEMOIN="example.org"
NOM="capture-sortante-$$"
DOSSIER="$(mktemp -d)"
trap 'docker rm -f "$NOM" >/dev/null 2>&1; rm -rf "$DOSSIER"' EXIT

non_abouti() { echo "NON ABOUTI : $1"; exit 2; }

docker inspect "$CIBLE" >/dev/null 2>&1 || non_abouti "conteneur $CIBLE introuvable"

docker pull -q "$IMAGE" >/dev/null || non_abouti "image $IMAGE indisponible"

# Au premier plan puis `&` : le bastion refuse `docker run -d`, et ce conteneur ne survit pas au script.
docker run --rm --name "$NOM" --network "container:$CIBLE" --cap-add NET_RAW --cap-add NET_ADMIN \
  -v "$DOSSIER:/cap" "$IMAGE" \
  timeout "$((DUREE + 10))" tcpdump -i eth0 -s 600 -U -w /cap/c.pcap \
  'udp port 53 or (tcp[tcpflags] & tcp-syn != 0 and tcp[tcpflags] & tcp-ack == 0) or (tcp dst port 443)' \
  >"$DOSSIER/tcpdump.log" 2>&1 &

sleep 8
[ "$(docker inspect -f '{{.State.Running}}' "$NOM" 2>/dev/null)" = "true" ] || non_abouti "tcpdump arrêté : $(tail -1 "$DOSSIER/tcpdump.log")"

docker run --rm --network "container:$CIBLE" "$IMAGE" \
  curl -s -o /dev/null --max-time 10 "https://$TEMOIN/" >/dev/null 2>&1

sleep "$DUREE"
docker stop -t 12 "$NOM" >/dev/null 2>&1

[ -s "$DOSSIER/c.pcap" ] || non_abouti "fichier de capture vide"

docker run --rm -v "$DOSSIER:/cap" "$IMAGE" tshark -r /cap/c.pcap -T fields -E separator='|' \
  -e ip.dst -e ipv6.dst -e tcp.dstport -e dns.qry.name -e tls.handshake.extensions_server_name \
  2>/dev/null >"$DOSSIER/champs.txt"

# Noms vus (DNS + SNI), IP publiques contactées.
noms="$(awk -F'|' '{ if ($4 != "") print $4; if ($5 != "") print $5 }' "$DOSSIER/champs.txt" | tr ',' '\n' | tr 'A-Z' 'a-z' | sort -u)"
ips="$(awk -F'|' '$3 != "" { print ($1 != "" ? $1 : $2) }' "$DOSSIER/champs.txt" \
  | grep -vE '^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|fe80:|fd|::1)' | sort -u)"

echo "$noms" | grep -qx "$TEMOIN" || non_abouti "témoin $TEMOIN non vu : l'instrument est aveugle"

autorise() {
  local n="$1" a
  [ "$n" = "$TEMOIN" ] && return 0
  while read -r a; do
    case "$a" in ''|\#*) continue ;; esac
    case "$n" in "$a"|*."$a") return 0 ;; esac
  done <"$AUTORISES"
  return 1
}

detectes=0
echo "── noms résolus ou contactés ──"
while read -r n; do
  [ -z "$n" ] && continue
  if autorise "$n"; then
    echo "  ok      $n"
  else
    echo "  ENVOI   $n"
    detectes=$((detectes + 1))
  fi
done <<<"$noms"

echo "── IP publiques contactées (dont le témoin) ──"
echo "${ips:-  aucune}"

if [ "$detectes" -gt 0 ]; then
  echo "VERDICT : $detectes destination(s) non autorisée(s)"
  exit 1
fi
echo "VERDICT : silence (hors témoin et liste autorisée), témoin vu, durée ${DUREE}s"
exit 0
