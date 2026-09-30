---
'@shipfox/api-integration-discord': minor
'@shipfox/api-integration-core': patch
---

Adds the Discord OAuth connect flow: an install route that returns the authorize URL, and a callback route that exchanges the code, checks the bot is in the server under the per-guild lock, and connects or reconnects it. The install state is bound to the browser that started it. Adds the OAuth code exchange and token revoke to the Discord REST client.
