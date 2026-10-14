#!/bin/sh
# A stdio MCP server in POSIX sh, so tests run it on the host and in a plain container image.
# FAKE_EXIT_CODE exits before answering, after FAKE_STDERR is written. FAKE_TOOLS replaces the
# listed tools. `secret_length` returns the length of FAKE_SECRET; `crash` exits with code 3.

if [ -n "$FAKE_STDERR" ]; then printf '%s\n' "$FAKE_STDERR" >&2; fi
if [ -n "$FAKE_EXIT_CODE" ]; then exit "$FAKE_EXIT_CODE"; fi

tools=${FAKE_TOOLS:-'{"name":"secret_length","inputSchema":{"type":"object"}},{"name":"crash","inputSchema":{"type":"object"}}'}

while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      version=$(printf '%s' "$line" | sed -n 's/.*"protocolVersion":"\([^"]*\)".*/\1/p')
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"%s","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1.0.0"}}}\n' "$id" "$version"
      ;;
    *'"method":"tools/list"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[%s]}}\n' "$id" "$tools"
      ;;
    *'"method":"tools/call"'*'"name":"crash"'*)
      exit 3
      ;;
    *'"method":"tools/call"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"length:%s"}]}}\n' "$id" "${#FAKE_SECRET}"
      ;;
  esac
done
