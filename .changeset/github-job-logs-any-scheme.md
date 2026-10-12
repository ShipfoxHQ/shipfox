---
"@shipfox/api-integration-github": patch
---

Download GitHub job log text from the URL GitHub redirects to without requiring `https://`. The URL comes from GitHub's own response, so the check protected nothing, and it kept `get_job_logs` with `return_content` from running against a GitHub API served over plain HTTP.
