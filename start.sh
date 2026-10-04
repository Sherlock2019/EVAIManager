#!/usr/bin/env bash
# VinFast AI Mobility Intelligence Lab — launcher
#
#   ./start.sh            start (Docker if it is usable, otherwise native)
#   ./start.sh docker     start with docker compose
#   ./start.sh native     start with a Python venv + the built dashboard, no Docker
#   ./start.sh stop       stop whatever start.sh started
#   ./start.sh status     show what is running and the URLs
#
# Both services listen on 0.0.0.0, so on an AWS EC2 instance the dashboard is
# reachable at http://<public-ip>:9063 once the security group allows inbound
# TCP on that port. Ports come from .env (FRONTEND_PORT, BACKEND_PORT); if one
# is already taken, the next free port is used and printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
FRONTEND_PORT="${FRONTEND_PORT:-9063}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
export FRONTEND_PORT BACKEND_PORT

RUN_DIR="$ROOT/.run"
MODE_FILE="$RUN_DIR/mode"
PORTS_FILE="$RUN_DIR/ports"
# native services get their own session, so they keep running after the SSH session that started them ends
DETACH="nohup"
command -v setsid >/dev/null 2>&1 && DETACH="setsid nohup"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

docker_usable() { docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

# EC2 public IPv4 from the instance metadata service (IMDSv2, then IMDSv1),
# then an external lookup, then the first local address.
public_ip() {
  local imds="http://169.254.169.254/latest" token ip=""
  token="$(curl -fs -m 2 -X PUT "$imds/api/token" -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
  if [[ -n "$token" ]]; then
    ip="$(curl -fs -m 2 -H "X-aws-ec2-metadata-token: $token" "$imds/meta-data/public-ipv4" 2>/dev/null || true)"
  else
    ip="$(curl -fs -m 2 "$imds/meta-data/public-ipv4" 2>/dev/null || true)"
  fi
  [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || ip="$(curl -fs -m 4 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "${ip:-localhost}"
}

wait_for() { # url, seconds
  local url="$1" left="$2"
  until curl -fs -m 3 -o /dev/null "$url"; do
    left=$((left - 2))
    ((left > 0)) || return 1
    sleep 2
  done
}

in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[:.]$1[[:space:]]"
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

# free unless something other than our own compose stack is listening on it
port_free() {
  docker compose ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$1->" && return 0
  ! in_use "$1"
}

# first free port at or above $1, skipping $2
next_free_port() {
  local port="$1" tries=0
  while ! port_free "$port" || [[ "$port" == "${2:-}" ]]; do
    port=$((port + 1))
    tries=$((tries + 1))
    ((tries < 200)) || die "No free port found between $1 and $port."
  done
  echo "$port"
}

# Use the configured ports if they are free, otherwise the next free ones, and
# remember the choice so `status` and `stop` report the same URLs.
resolve_ports() {
  local want_backend="$BACKEND_PORT" want_frontend="$FRONTEND_PORT"
  BACKEND_PORT="$(next_free_port "$want_backend")"
  FRONTEND_PORT="$(next_free_port "$want_frontend" "$BACKEND_PORT")"
  [[ "$BACKEND_PORT" == "$want_backend" ]] || say "Port $want_backend is in use; the API will use $BACKEND_PORT."
  [[ "$FRONTEND_PORT" == "$want_frontend" ]] || say "Port $want_frontend is in use; the dashboard will use $FRONTEND_PORT."
  export FRONTEND_PORT BACKEND_PORT
  mkdir -p "$RUN_DIR"
  printf 'FRONTEND_PORT=%s\nBACKEND_PORT=%s\n' "$FRONTEND_PORT" "$BACKEND_PORT" > "$PORTS_FILE"
}

# ports chosen by the last start, for commands that act on what is already running
load_saved_ports() {
  [[ -f "$PORTS_FILE" ]] || return 0
  # shellcheck disable=SC1090
  . "$PORTS_FILE"
  export FRONTEND_PORT BACKEND_PORT
}

alive() { [[ -f "$RUN_DIR/$1.pid" ]] && kill -0 "$(cat "$RUN_DIR/$1.pid")" 2>/dev/null; }

print_urls() {
  local ip
  ip="$(public_ip)"
  cat <<EOF

  Dashboard   http://$ip:$FRONTEND_PORT
  Ride demand http://$ip:$FRONTEND_PORT/energy/demand
  API docs    http://$ip:$BACKEND_PORT/api/docs
  (on this machine: http://localhost:$FRONTEND_PORT)

  On AWS EC2, allow inbound TCP $FRONTEND_PORT in the instance's security group
  (and $BACKEND_PORT only if you want the API docs reachable from outside).
  Stop with: ./start.sh stop
EOF
}

start_docker() {
  docker_usable || die "Docker is not usable here (is the daemon running, and is this user in the docker group?). Try: ./start.sh native"
  stop_native quiet   # a native run left over would hold the same ports
  resolve_ports
  say "Building and starting containers…"
  mkdir -p "$RUN_DIR" && echo docker > "$MODE_FILE"
  docker compose up --build -d
  say "Waiting for the dashboard…"
  wait_for "http://127.0.0.1:$FRONTEND_PORT/api/health" 240 || die "Not healthy after 4 minutes. Check: docker compose logs"
  say "Running in Docker."
  print_urls
}

start_native() {
  command -v python3 >/dev/null || die "python3 not found. Ubuntu: sudo apt-get install -y python3 python3-venv"
  command -v node >/dev/null || die "Node.js 20+ not found. See https://nodejs.org or: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  (( $(node -p 'process.versions.node.split(".")[0]') >= 20 )) || die "Node.js 20+ is required (found $(node -v))."
  mkdir -p "$RUN_DIR"
  stop_native quiet
  resolve_ports

  if [[ ! -x backend/.venv/bin/uvicorn ]]; then
    say "Creating the Python environment…"
    python3 -m venv backend/.venv || die "Could not create a venv. Ubuntu: sudo apt-get install -y python3-venv"
    backend/.venv/bin/pip install --quiet --upgrade pip
    backend/.venv/bin/pip install --quiet -r backend/requirements.txt
  fi
  if [[ ! -x frontend/node_modules/.bin/vite ]]; then
    say "Installing dashboard dependencies…"
    (cd frontend && npm ci --no-audit --no-fund)
  fi
  say "Building the dashboard…"
  (cd frontend && npm run build)

  say "Starting the API on 0.0.0.0:$BACKEND_PORT…"
  (
    cd backend
    $DETACH .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" > "$RUN_DIR/backend.log" 2>&1 < /dev/null &
    echo $! > "$RUN_DIR/backend.pid"
  )
  # the first start generates the synthetic world, which takes a few seconds
  wait_for "http://127.0.0.1:$BACKEND_PORT/api/health" 120 || { tail -n 30 "$RUN_DIR/backend.log" >&2; die "The API did not come up."; }

  say "Starting the dashboard on 0.0.0.0:$FRONTEND_PORT…"
  (
    cd frontend
    VITE_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" $DETACH node_modules/.bin/vite preview --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort > "$RUN_DIR/frontend.log" 2>&1 < /dev/null &
    echo $! > "$RUN_DIR/frontend.pid"
  )
  wait_for "http://127.0.0.1:$FRONTEND_PORT/api/health" 40 || { tail -n 30 "$RUN_DIR/frontend.log" >&2; die "The dashboard did not come up (is port $FRONTEND_PORT already in use?)."; }

  echo native > "$MODE_FILE"
  say "Running natively. Logs: .run/backend.log, .run/frontend.log"
  print_urls
}

stop_native() {
  local name pid
  for name in frontend backend; do
    if alive "$name"; then
      pid="$(cat "$RUN_DIR/$name.pid")"
      kill "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$pid" 2>/dev/null || true
      [[ "${1:-}" == quiet ]] || say "Stopped $name (pid $pid)."
    fi
    rm -f "$RUN_DIR/$name.pid"
  done
}

stop_all() {
  stop_native
  if [[ -f "$MODE_FILE" && "$(cat "$MODE_FILE")" == docker ]] && docker_usable; then
    docker compose down
  fi
  rm -f "$MODE_FILE" "$PORTS_FILE"
  say "Stopped."
}

status() {
  local mode="none"
  [[ -f "$MODE_FILE" ]] && mode="$(cat "$MODE_FILE")"
  echo "mode: $mode"
  if [[ "$mode" == docker ]]; then
    docker compose ps
  else
    for name in backend frontend; do
      alive "$name" && echo "$name: running (pid $(cat "$RUN_DIR/$name.pid"))" || echo "$name: not running"
    done
  fi
  if curl -fs -m 3 -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/api/health"; then
    echo "health: ok"
    print_urls
  else
    echo "health: dashboard not answering on port $FRONTEND_PORT"
  fi
}

case "${1:-auto}" in
  auto) if docker_usable; then start_docker; else start_native; fi ;;
  docker) start_docker ;;
  native) start_native ;;
  stop) load_saved_ports; stop_all ;;
  status) load_saved_ports; status ;;
  *) die "usage: ./start.sh [docker|native|stop|status]" ;;
esac
