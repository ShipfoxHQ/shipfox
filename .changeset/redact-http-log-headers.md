---
"@shipfox/node-log": patch
---

Stops logging credentials. The `req` serializer keeps only the `user-agent` and `x-forwarded-for` headers, and the `res` serializer keeps only the status code. Error serializers drop the `options`, `request`, `response`, and `config` fields of HTTP client errors, and redact `authorization`, `cookie`, `proxy-authorization`, and `set-cookie` fields at any depth.
