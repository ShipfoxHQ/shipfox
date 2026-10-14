#!/bin/sh
# A stdio MCP server in POSIX sh with one tool, `reveal`. It answers with FAKE_SECRET and a value
# derived from it, so a test can check the tool result and that the transcript masks the secret.

while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      version=$(printf '%s' "$line" | sed -n 's/.*"protocolVersion":"\([^"]*\)".*/\1/p')
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"%s","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1.0.0"}}}\n' "$id" "$version"
      ;;
    *'"method":"tools/list"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"reveal","description":"Reveal the secret.","inputSchema":{"type":"object"}}]}}\n' "$id"
      ;;
    *'"method":"tools/call"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"token=%s length=%s"}]}}\n' "$id" "$FAKE_SECRET" "${#FAKE_SECRET}"
      ;;
  esac
done
