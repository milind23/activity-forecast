#!/usr/bin/env bash
# Usage: examples/query.sh [file.graphql ...]   (default: chamonix.graphql)
# Env:   URL (default http://localhost:3000/graphql)
# Needs curl; uses jq to pretty-print if available, otherwise node.
set -euo pipefail
URL="${URL:-http://localhost:3000/graphql}"
DIR="$(cd "$(dirname "$0")" && pwd)"
[ $# -eq 0 ] && set -- "$DIR/chamonix.graphql"

for f in "$@"; do
  [ -f "$f" ] || f="$DIR/$f"
  echo "### $(basename "$f")" >&2
  body=$(node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({query:fs.readFileSync(process.argv[1],"utf8")}))' "$f")
  resp=$(curl -sS -X POST "$URL" -H 'Content-Type: application/json' --data "$body")
  if command -v jq >/dev/null 2>&1; then echo "$resp" | jq .; else echo "$resp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))'; fi
done
