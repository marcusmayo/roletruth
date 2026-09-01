#!/usr/bin/env bash
set -euo pipefail

preview_pid_file="/tmp/roletruth-preview.pid"
preview_log_file="/tmp/roletruth-preview.log"

if curl -fsS --max-time 1 http://127.0.0.1:3000/ >/dev/null 2>&1; then
  exit 0
fi

if [[ -f "$preview_pid_file" ]]; then
  preview_pid="$(<"$preview_pid_file")"
  if [[ "$preview_pid" =~ ^[0-9]+$ ]] && kill -0 "$preview_pid" 2>/dev/null; then
    exit 0
  fi
fi

nohup npm run dev:codespaces >"$preview_log_file" 2>&1 &
echo "$!" >"$preview_pid_file"
