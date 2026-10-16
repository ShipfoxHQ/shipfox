---
"@shipfox/client-shell": minor
"@shipfox/client-auth": patch
"@shipfox/client-invitations": patch
---

The client reads the server's login methods, so visitors on a server without password login no longer reach password pages that cannot submit.

- **`@shipfox/client-shell`:** `/runtime` exports `loginMethodsQueryOptions()` and `prefetchLoginMethods()` for `GET /auth/login-methods`, and `usePasswordLoginAvailability()`, which returns `pending`, `available`, or `unavailable`. It stays `pending` while the lookup retries or waits offline. A lookup that still fails counts as `available`, which keeps the password pages.
- **`@shipfox/client-auth`:** without password login, the login page hides the password form and its **Forgot password?** and **Create an account** links, and `/auth/signup` and `/auth/reset` redirect to `/auth/login`, keeping `redirect`.
- **`@shipfox/client-invitations`:** without password login, a signed-out invitee sees one **Continue** button to the login page instead of **Create account** and **I already have an account**.
