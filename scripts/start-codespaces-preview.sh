#!/usr/bin/env bash
set -euo pipefail

preview_pid_file="/tmp/roletruth-preview.pid"
preview_log_file="/tmp/roletruth-preview.log"
preview_signature_file="/tmp/roletruth-preview.signature"
preview_signature="next-solari-node-v1"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_configured=false

command -v setsid >/dev/null || {
  echo "[roletruth] The Codespaces preview requires Linux setsid." >&2
  exit 69
}
command -v pgrep >/dev/null || {
  echo "[roletruth] The Codespaces preview requires pgrep." >&2
  exit 69
}

if [[ -n "${SOLARI_API_KEY:-}" ]]; then
  expected_configured=true
  echo "[roletruth] Codespaces secret: present"
else
  echo "[roletruth] Codespaces secret: missing (demo mode remains available)"
fi

server_status="$(
  curl -fsS --max-time 2 http://127.0.0.1:3000/api/solari/status 2>/dev/null || true
)"
running_signature=""
if [[ -f "$preview_signature_file" ]]; then
  running_signature="$(<"$preview_signature_file")"
fi

if [[ "$server_status" == *"\"configured\":${expected_configured}"* ]] &&
  [[ "$running_signature" == "$preview_signature" ]]; then
  echo "[roletruth] Preview already matches the current secret state."
  exit 0
fi

stop_owned_preview() {
  [[ -f "$preview_pid_file" ]] || return 1

  local preview_pid preview_cwd preview_command
  preview_pid="$(<"$preview_pid_file")"
  [[ "$preview_pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$preview_pid" 2>/dev/null || return 1

  preview_cwd="$(readlink -f "/proc/${preview_pid}/cwd" 2>/dev/null || true)"
  preview_command="$(tr '\0' ' ' <"/proc/${preview_pid}/cmdline" 2>/dev/null || true)"
  [[ "$preview_cwd" == "$project_root" ]] || return 1
  [[ "$preview_command" == *"npm run dev:codespaces"* ]] || return 1

  local preview_pgid child_pid
  preview_pgid="$(ps -o pgid= -p "$preview_pid" 2>/dev/null | tr -d ' ' || true)"

  echo "[roletruth] Restarting the managed preview so its secret state is current."
  if [[ "$preview_pgid" == "$preview_pid" ]]; then
    # New previews run in a dedicated session, so this reaches npm, Next, and
    # every child without touching the Codespaces editor process group.
    kill -- "-${preview_pid}" 2>/dev/null || true
  else
    # Migrate a preview started by the original script, which did not create a
    # dedicated process group. Collect the owned descendants before stopping it.
    local -a descendants=()
    collect_descendants() {
      local parent_pid="$1" child_pid
      while read -r child_pid; do
        [[ -n "$child_pid" ]] || continue
        collect_descendants "$child_pid"
        descendants+=("$child_pid")
      done < <(pgrep -P "$parent_pid" || true)
    }
    collect_descendants "$preview_pid"
    for child_pid in "${descendants[@]}"; do
      kill "$child_pid" 2>/dev/null || true
    done
    kill "$preview_pid" 2>/dev/null || true
  fi

  for _ in {1..20}; do
    if ! curl -fsS --max-time 0.5 http://127.0.0.1:3000/ >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

if ! stop_owned_preview; then
  if [[ -n "$server_status" ]]; then
    echo "[roletruth] Port 3000 is running with a stale secret state, but it is not the managed RoleTruth preview." >&2
    echo "[roletruth] Stop that process, then rerun this script." >&2
    exit 1
  fi
fi

cd "$project_root"
nohup setsid npm run dev:codespaces >"$preview_log_file" 2>&1 &
echo "$!" >"$preview_pid_file"
echo "$preview_signature" >"$preview_signature_file"

for _ in {1..30}; do
  server_status="$(
    curl -fsS --max-time 0.5 http://127.0.0.1:3000/api/solari/status 2>/dev/null || true
  )"
  if [[ "$server_status" == *"\"configured\":${expected_configured}"* ]]; then
    echo "[roletruth] Preview ready; Solari configured=${expected_configured}."
    exit 0
  fi
  sleep 0.25
done

echo "[roletruth] Preview did not inherit the expected secret state." >&2
echo "[roletruth] Review ${preview_log_file} for the server-side error." >&2
exit 1
