# report-cli

Prints a count of issues by status.

```sh
report            # one "status: total" line per status
report --json     # the same rows as a JSON array
```

The command-line flags are read in `src/report.js`. `src/cli.js` only loads the rows and prints the result.
