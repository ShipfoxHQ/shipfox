# Database-boundaries Biome plugin

This directory contains the published GritQL guardrail for database schema
ownership. `no-direct-table-declaration.grit` rejects imports of `pgTable` or
`pgTableCreator` directly from `drizzle-orm/pg-core`; database packages should
import the owner-registered factory from their local schema boundary instead.

The rule is intentionally generic. Configure its `includes` for database
source and exclude the one registered factory file, for example:

```json
{
  "plugins": [
    {
      "path": "./node_modules/@shipfox/biome/plugins/database-boundaries/no-direct-table-declaration.grit",
      "includes": [
        "**/libs/api/**/src/db/**",
        "!**/libs/api/**/src/db/schema/common.ts"
      ]
    }
  ]
}
```

The diagnostic ID is `database-boundaries/no-direct-table-declaration` and is
part of the published package contract.
