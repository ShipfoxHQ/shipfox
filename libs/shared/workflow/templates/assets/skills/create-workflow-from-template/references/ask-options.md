# Ask a template question

Use this format in `skill://shipfox/create-workflow-from-template/SKILL.md` for each option, each optional role's `question`, and each value the guide says to replace.

The user decides what they will see and get, not how the YAML changes. Lead with that impact and keep the rest out.

## Format

Ask the template's `question`, then list one line per choice: its `label`, "(default)" on the default choice, and its `tradeoff`.

```text
Which projects should report their failures?

1. This project (default): only failures in Cloud are reported.
2. Every project: failures from every project in the workspace go to one channel. Set up this workflow in one project only, or each failure is reported more than once.
```

For an optional role, ask its `question` and put its `tradeoff` on the next line.

## Rules

- Keep the template's wording. Replace generic words with names you already know, such as the project or channel name.
- Never add how the workflow implements a choice: event fields, filters, option markers, or IDs you can look up yourself.
- If a choice needs input you cannot find yourself, say what the user will provide after they choose it, such as "You pick the workflows next."
- Never put the choices inside the question sentence or answer the question for the user.

Avoid:

> Should failure reports cover only the Cloud project (default), or every project in this Shipfox workspace? Cloud limits the workflow to this project; every project sends all workspace failures to one Slack channel.

## Ask for a value

For a value such as a channel ID, ask one short question and name the form you need:

```text
Which Slack channel should we notify? Provide the channel ID.
```

- If a tool in your session can list the values, such as a Slack MCP server that lists channels, look them up first and suggest the best match by name and ID. The user confirms it or picks another.
- Never suggest a value found in repository files, such as a channel from a test or CI configuration.
- Otherwise, say where to find the value in one sentence, such as "Slack shows it at the bottom of the channel details."
- Leave out how the workflow uses the value, such as what it posts there or which events it accepts, and choices the user already made.
