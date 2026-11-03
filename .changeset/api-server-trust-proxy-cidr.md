---
"@shipfox/api-server": major
---

`API_TRUST_PROXY` no longer accepts a hop count such as `1`, and the API fails at startup when one is set. Fastify 5.12.1 stopped trusting any proxy for a hop count because a hop count cannot verify the peer that sent the `X-Forwarded-*` headers, so the API would have attributed every request to the proxy. Set the trusted proxy IP/CIDR instead, such as the load balancer subnet.
