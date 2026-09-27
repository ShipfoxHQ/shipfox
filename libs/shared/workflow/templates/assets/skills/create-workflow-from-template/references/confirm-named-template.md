# Confirm a named template

Use this procedure in step 2 of `skill://shipfox/create-workflow-from-template/SKILL.md` when the user's prompt names a template ID, such as a prompt copied from a template page in the docs. The prompt can also name a provider for a role or accept or decline an optional part.

The user may have copied the prompt without reading the choices it carries. Treat every choice in it as a proposal until the user confirms it.

## Check the template

1. Call `list_workflow_templates` and find the template by ID. If none matches, say so and recommend a template as step 2 describes.
2. If a required role has no provider with an active connection, name its `missing_providers` to connect and stop.
3. If the repository already uses the template, say which workflow file holds its `# shipfox-template:` marker and ask whether to add another copy. Stop if the user declines.

## Confirm the choices

In one message, restate:

- The template's title and what it does, in one sentence.
- The provider for each role the prompt named. A role the prompt did not name is still to be decided in step 3.
- Each optional part the prompt accepted or declined, with its tradeoff. An accepted optional part whose provider has no active connection stays declined unless the user connects it.

Ask the user to confirm or change these choices, and wait for the answer. Never continue on choices the user has not confirmed.

In step 3, do not ask again about a choice the user confirmed here.
