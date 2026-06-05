#!/bin/sh
set -e

# Named/bind volumes may mount with root-owned directories; ensure the service
# user can write atomically (e.g. mcp_user_config.json.tmp) under these paths.
for dir in /app/agent/runs /app/agent/sessions /app/agent/config /app/agent/uploads; do
  mkdir -p "$dir"
  chown -R vibe:vibe "$dir"
done

exec gosu vibe "$@"
