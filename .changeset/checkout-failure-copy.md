---
"@shipfox/api-workflows": patch
"@shipfox/client-workflows": patch
"@shipfox/runner-protocol": patch
"@shipfox/runner-execution": patch
---

Shows the cause of a checkout failure and its fix. The failure annotation and the run page choose their copy from the error code of the refused checkout, and show the provider's own explanation when there is one. A refused checkout-token request now returns its cause in `details.message`, and a provider refusal names the repository and the connection.
