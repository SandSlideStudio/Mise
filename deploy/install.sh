#!/bin/sh
# Install or update Mise on this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/SandSlideStudio/Mise/main/deploy/install.sh | sh
#
# Needs Docker with the compose plugin. Creates ./mise-kitchen (or $MISE_DIR),
# writes a .env with fresh secrets the first time, and starts Mise. Running it
# again pulls the newest release and keeps your existing .env.
set -eu

# Run from inside an existing Mise folder, it updates that one in place.
if [ -z "${MISE_DIR:-}" ] && [ -f compose.yaml ] && grep -q '^name: mise-kitchen' compose.yaml; then
  MISE_DIR=.
fi
MISE_DIR="${MISE_DIR:-mise-kitchen}"
MISE_REF="${MISE_REF:-main}"
MISE_SOURCE="${MISE_SOURCE:-https://raw.githubusercontent.com/SandSlideStudio/Mise/$MISE_REF/deploy}"

say() { printf '%s\n' "$*"; }
fail() { printf 'mise: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Get it from https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || fail "Docker is installed but the compose plugin is not. See https://docs.docker.com/compose/install/"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running, or this user may not use it."

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    fail "Needs curl or wget to download the setup files."
  fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

mkdir -p "$MISE_DIR"
cd "$MISE_DIR"

say "Downloading the setup files into $(pwd)"
fetch "$MISE_SOURCE/compose.yaml" compose.yaml
fetch "$MISE_SOURCE/Caddyfile" Caddyfile

if [ -f .env ]; then
  say "Keeping the existing .env and its secrets."
else
  fetch "$MISE_SOURCE/.env.example" .env.example
  session_secret="$(random_secret)"
  db_password="$(random_secret)"
  setup_code="$(random_secret | cut -c1-24)"
  sed -e "s/^SESSION_SECRET=.*/SESSION_SECRET=$session_secret/" \
      -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$db_password/" \
      -e "s/^SETUP_TOKEN=.*/SETUP_TOKEN=$setup_code/" \
      .env.example > .env
  chmod 600 .env
  rm .env.example
  say "Wrote .env with new secrets. Keep it safe, and back it up with your data."
fi

say "Downloading the newest Mise"
if ! docker compose pull --quiet; then
  say "Could not download it. Starting the version already on this machine, if there is one."
fi
say "Starting Mise"
docker compose up -d --remove-orphans

port="$(sed -n 's/^PORT=//p' .env)"
port="${port:-3000}"

say "Waiting for Mise to answer"
tries=0
until docker compose exec -T app wget -qO /dev/null http://127.0.0.1:3000/api/health >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 90 ] || fail "Mise did not start within three minutes. See: cd $(pwd) && docker compose logs app"
  sleep 2
done

address="localhost"
if command -v hostname >/dev/null 2>&1; then
  lan="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
  [ -n "${lan:-}" ] && address="$lan"
fi

needs_setup="$(docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/setup/status').then(r=>r.json()).then(s=>console.log(s.needsSetup)).catch(()=>console.log('unknown'))" 2>/dev/null | tr -d '\r')"
setup_code="$(sed -n 's/^SETUP_TOKEN=//p' .env)"

say ""
if [ "$needs_setup" = "true" ] && [ -n "$setup_code" ]; then
  say "Mise is running. Open this link in a browser to set up your kitchen:"
  say ""
  say "  http://$address:$port/setup?token=$setup_code"
  say ""
  say "The link only works until the kitchen is set up."
elif [ "$needs_setup" = "true" ]; then
  say "Mise is running. The setup link is in the log: docker compose logs app"
else
  say "Mise is running: http://$address:$port"
fi
say "To update later, run the same command again inside $(pwd)."
