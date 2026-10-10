---
"@shipfox/api-runners-dto": major
"@shipfox/api-agent-dto": major
"@shipfox/api-runners": patch
"@shipfox/api-agent": patch
"@shipfox/api-workflows": patch
---

Treats every runner as able to renew Git and managed inference credentials. The runner capability manifest no longer has `features`, and `runnerFeaturesSchema` and `RunnerFeaturesDto` are removed. Registration still accepts a `features` key from older runner images and ignores it. `ManagedModelProvider.resolveCredentials` no longer receives `renewableInference`, and `RUNNER_CAPABILITY_REQUIRED_ERROR_CODE` with its `runner-capability-required` error is removed. A composing application must stop using both and always issue renewable credentials. The API no longer writes the "Renewable Git credentials are unavailable on this runner" annotation.
