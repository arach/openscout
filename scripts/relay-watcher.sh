#!/usr/bin/env bash
# relay-watcher: monitors an agent's inbox and injects messages into its tmux session
# Usage: relay-watcher.sh <agent-name> <tmux-session>
# Designed to run as a background process alongside a twin

set -euo pipefail

AGENT="${1:-dev}"
TMUX_SESSION="${2:-relay-dev}"
HUB="$HOME/.openscout/relay"
INBOX="$HUB/inbox/${AGENT}.md"
POLL_INTERVAL=2

log() {
  printf "[relay-watcher:%s] %s\n" "$AGENT" "$*" >&2
}

log "watching inbox for @${AGENT} → tmux:${TMUX_SESSION}"

while true; do
  sleep "$POLL_INTERVAL"

  # Check if inbox has content
  if [[ ! -f "$INBOX" ]]; then
    continue
  fi

  CONTENT=$(cat "$INBOX" 2>/dev/null || true)
  if [[ -z "$CONTENT" ]]; then
    rm -f "$INBOX"
    continue
  fi

  # Check if tmux session is alive
  if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    log "tmux session ${TMUX_SESSION} not found, skipping"
    continue
  fi

  # Consume the inbox
  rm -f "$INBOX"

  # Extract the most recent message body (last [RELAY MESSAGE] block)
  # Send just the core message text, not the full relay envelope
  LAST_MSG=$(echo "$CONTENT" | python3 -c "
import sys
blocks = sys.stdin.read().strip().split('[RELAY MESSAGE]')
blocks = [b.strip() for b in blocks if b.strip()]
if blocks:
    last = blocks[-1]
    lines = last.split('\n')
    # Skip From/To headers and --- footer
    body_lines = []
    in_body = False
    for line in lines:
        if line.startswith('From:') or line.startswith('To:'):
            continue
        if line.startswith('---'):
            break
        if line.strip():
            in_body = True
        if in_body:
            body_lines.append(line)
    msg = '\n'.join(body_lines).strip()
    # If multiple messages queued, note that
    count = len(blocks)
    if count > 1:
        print(f'[relay: {count} messages, showing latest] {msg}')
    else:
        print(msg)
" 2>/dev/null || echo "$CONTENT")

  if [[ -z "$LAST_MSG" ]]; then
    continue
  fi

  log "delivering: ${LAST_MSG:0:60}..."

  # Inject into tmux — send as user input to Claude Code
  # Use send-keys to type the message at the prompt
  tmux send-keys -t "$TMUX_SESSION" "$LAST_MSG" Enter

  # Write heartbeat
  t=$(date +%s)
  echo "${t} ${AGENT} SYS watcher-delivery" >> "$HUB/channel.log"
done
