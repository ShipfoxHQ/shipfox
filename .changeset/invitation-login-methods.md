---
"@shipfox/client-shell": minor
"@shipfox/client-auth": patch
"@shipfox/client-invitations": patch
---

The client reads the server's login methods, so invitees on a server without password login no longer land on a signup form that cannot submit.

- **`@shipfox/client-shell`:** `useLoginMethods()` and `loginMethodsQueryOptions()` from `/runtime` return the login method ids from `GET /auth/login-methods`.
- **`@shipfox/client-auth`:** `/auth/signup` and `/auth/reset` redirect to `/auth/login` when the server offers no `password` login method, and keep `redirect`.
- **`@shipfox/client-invitations`:** a signed-out invitee sees one **Continue** button to the login page when the server offers no `password` login method, or when the lookup fails. With password login, the page keeps **Create account** and **I already have an account**.
