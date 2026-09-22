# Docs

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Before writing or editing any page under `content/docs/`, read the repo-wide
[WRITING.md](../../WRITING.md) (style, sentences, punctuation, language level)
and then [apps/docs/WRITING.md](WRITING.md) (page types, the concept-page
template, example rules, and schema-documentation rules).

Run development server:

```bash
pnpm dev
```

Open http://localhost:3500 with your browser to see the result.

## Analytics

The production Vercel deployment requires these public browser variables:

```text
NEXT_PUBLIC_POSTHOG_KEY=<project token>
NEXT_PUBLIC_POSTHOG_URL=<HTTPS ingestion URL>
```

Set them only for the Vercel production environment. Local development and
preview deployments omit both variables and do not send analytics. The values
are included in browser code and visible in network requests, so neither value
is a secret.

The docs record every production session. In the PostHog project, keep session
recording at 100% with no URL or event trigger, and keep request and response
bodies, headers, and console logs disabled. Inputs are masked by the client SDK.

## Ask AI

Ask AI answers questions from these pages. It reads two variables:

```text
OPENROUTER_API_KEY=<OpenRouter API key>
ASK_AI_MODEL=z-ai/glm-5.3-flash
```

`OPENROUTER_API_KEY` is a secret and never reaches the browser. Set it in
`apps/docs/.env.local` for local work, and in the Vercel project for the
environments that should answer questions. A deployment without the key renders
no Ask AI trigger, and `POST /api/chat` returns 503.

`ASK_AI_MODEL` accepts any [OpenRouter model ID](https://openrouter.ai/models).
The model must support tool calling, because every answer starts with a
retrieval call. Changing it needs no code change and no redeploy of the route.
`deepseek/deepseek-v4.1-flash` is the other open-weight candidate, and
`anthropic/claude-sonnet-5` falls back to a first-party model.

Retrieval makes this workload input-heavy, so the input price dominates. The
catalog is a fixed ~4700 tokens per request, and the pages the model reads add
roughly 2000 to 20000 more, so a question costs a fraction of a cent to a few
cents. That makes the choice one of answer quality rather than cost. Measure a
model on real questions and keep whichever holds up.

One model ID is not one product. An open-weight model reaches OpenRouter through
many providers, whose prices differ several fold and whose quantization differs
too. `PROVIDER_ROUTING` in the route handler holds the routing rules that decide
which of them may serve a request. It deliberately does not sort by latency:
that picks whichever endpoint answers fastest at the moment, which is the one
most likely to be serving a degraded variant. When answers go bad in a run,
read `provider` on `docs_ask_ai_answered` before blaming the model ID.

Five PostHog events cover the panel: `docs_ask_ai_question_asked`,
`docs_ask_ai_answered`, `docs_ask_ai_citation_clicked`, `docs_ask_ai_failed`, and
`docs_ask_ai_retried`. The ones worth watching are `has_answer`, which is false
when a turn ended having only read pages, `provider` and `finish_reason`, which
together attribute a bad answer to the endpoint that served it, and
`docs_ask_ai_citation_clicked`, which is the closest proxy for an answer being
useful. Spend, latency, and token counts are not captured here, because the
OpenRouter dashboard already reports them per request.

These events carry the question text. It goes through the same redaction as the
catalog search box. Redaction replaces the whole value rather
than trimming it. It fires on an email address, a URL, a credential assignment,
or a long unbroken token. The cap for a question is 240
characters, above the catalog cap because a question is a sentence. Session
recordings mask the input, so the question reaches PostHog only through these
events.

`src/app/api/chat/route.ts` is a plain Vercel AI SDK route handler, so OpenRouter
is one line of it. To route through Vercel AI Gateway instead, replace
`createOpenRouter` with `@ai-sdk/gateway`; to call a provider directly, use that
provider's AI SDK package. The panel and the retrieval tool do not change.

The instructions carry the whole page catalog: every page, its path, and its
description, built by `src/lib/page-catalog.ts` and shared with `llms.txt`. The
model picks pages from that list and reads them with the `read_page` tool, which
returns a page whole as Markdown from `getLLMText`, so it reads what
`llms-full.txt` publishes.

Two constraints hold this together, and both are load-bearing. Pages are never
truncated: the pages Ask AI most needs are generated reference catalogs whose
useful part sits well past any sane cap, so a length limit reliably hides the
exact fact the question was about. And `prepareStep` drops tools on the final
step, so a run cannot spend its whole budget on retrieval and end with no text,
which reaches the reader as a silent hang rather than an error.

## Explore

The project includes:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `app/layout.config.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |
| `app/api/chat/route.ts`   | The Route Handler for Ask AI.                          |

### Fumadocs MDX

The repository includes a `source.config.ts` file. Customize options such as
the frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.vercel.app) - learn about Fumadocs
