---
"@shipfox/client-integrations": minor
"@shipfox/client-triggers": minor
---

Add reusable, source-keyed icon building blocks so any surface can render an integration or trigger icon without re-implementing the catalog lookup and fallback.

`@shipfox/client-integrations` exposes `getIntegrationIcon(source)` and `<IntegrationIcon source />`, resolving an integration source (a connection `provider`, a run `trigger_source`, or a trigger event `source`) against the central `PROVIDER_CATALOG` with a neutral `componentLine` fallback. The catalog stays the single place each integration declares its icon; the integration gallery now renders `<IntegrationIcon>` instead of an inline lookup (no behavior change).

New `@shipfox/client-triggers` package adds `getTriggerSourceIcon(source)` and `<TriggerSourceIcon source />`, built on the integration resolver. It recognizes the system trigger sources `manual` (a person fired the run) and `cron` (a schedule), and delegates every other source to the integration catalog. This is the building block for showing an icon on run rows and trigger events; adopting it on those surfaces lands separately.
