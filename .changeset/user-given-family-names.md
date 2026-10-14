---
'@shipfox/api-auth': minor
'@shipfox/api-auth-dto': minor
---

Users can store an optional given name and family name next to their display name.

- **Signup:** `POST /auth/signup` accepts optional `given_name` and `family_name`.
- **Provisioning:** `provisionUser` accepts optional `givenName` and `familyName`, for providers that return them as separate claims.
- **Responses:** `UserDto` includes `given_name` and `family_name`, which are `null` when unknown.
- **Events:** `auth.user.signed_up` carries `givenName` and `familyName` when they are set.
