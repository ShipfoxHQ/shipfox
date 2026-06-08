# Runtime Formalization Docs

This folder is the repo-owned documentation set for PR1 workflow runtime formalization.

Read `000-requirements-ledger.md` first. It lists what PR1 includes, what is intentionally deferred, and which code owns each concept. Then read `001` through `007` for the formalization layers, followed by `008` and `009` for the extension and generation process.

## Target

The target is not to expand the workflow language in this PR. The target is to make the existing minimal workflow path precise, executable, and reviewable:

```text
YAML source
  -> SurfaceWorkflowDocument
  -> WorkflowIR
  -> static semantics
  -> runtime transitions
  -> durable execution host
```

This documentation set is the repo-owned version of that foundation. Future concepts, including a richer expression language, interpolation, and predicate/premise logic, should enter through the process in `008-adding-new-concepts.md` instead of being added directly to runtime code.

## Surface Language Portability

YAML is the only PR1 authoring surface, but the formalization must keep workflow concepts portable to future surfaces such as CUE, TypeScript SDKs, Python SDKs, generated workflows, and UI builders.

Surface-specific parsers should accept syntax and produce Shipfox workflow concepts. They should not define unique runtime semantics. Defaults, inheritance, expression meaning, validation rules, and runtime behavior must be owned by normalization, IR, static semantics, and runtime semantics so equivalent workflows from different surfaces converge before execution.

See `008-adding-new-concepts.md` for the detailed rules, examples, and review checklist.

## Architecture Overview

The formalization separates authoring, validation, semantic decisions, and durable effects so each layer has a small responsibility and a clear owner.

| Layer | Purpose | Owner |
| --- | --- | --- |
| YAML surface | Accept the current author-facing workflow syntax and preserve PR1 wire compatibility. | `@shipfox/api-workflow-language` |
| CUE formalization artifact | Provide a schema-shaped formal reference for the accepted YAML surface without making CUE an accepted PR1 input language. | `@shipfox/api-workflow-language` |
| Expression boundary | Document the minimal current expression representation and the deferred path toward parser, evaluator, interpolation, and predicate/premise logic. | `@shipfox/api-workflow-language` |
| WorkflowIR | Normalize authoring syntax into stable, code-owned workflow concepts used by static semantics and runtime semantics. | `@shipfox/api-workflow-language` |
| Static semantics | Reject invalid normalized workflows with stable diagnostics before persistence or execution. | `@shipfox/api-workflow-language` |
| Pure runtime kernel | Define replayable workflow execution decisions from normalized runtime state and external signals. | `@shipfox/api-workflows` |
| Durable execution host | Run the pure kernel reliably through Temporal, activities, workers, persistence, queues, timers, and external side effects. | `@shipfox/api-workflows` |

The pure runtime kernel defines workflow semantics. The durable execution host runs those semantics reliably and adapts emitted commands into Temporal child workflows, activities, database writes, runner work, and future external integrations.

This split is intentional:

- It keeps YAML compatibility separate from the internal model Shipfox executes.
- It makes validation deterministic and testable before rows, jobs, or Temporal workflows are created.
- It keeps scheduling semantics pure enough for unit tests and golden traces.
- It keeps Temporal, persistence, outbox, runner, and future integration effects outside the pure kernel.
- It gives future concepts a required path through requirements, surface, IR, diagnostics, runtime semantics, durable execution host changes, generated docs, and tests.

## Status Meanings

| Status | Meaning |
| --- | --- |
| `normative` | Describes committed PR1 behavior or the committed process for extending it. |
| `deferred` | Documents a concept that PR1 intentionally does not implement. |
| `exploratory` | Captures future product or platform examples. Exploratory YAML snippets are not accepted PR1 syntax unless another normative document says so. |

## Document Roles

| Doc | Status | Generated | Generator Owner | Role |
| --- | --- | --- | --- | --- |
| `000-requirements-ledger.md` | `normative` | yes | `@shipfox/api-workflow-language` | Review ledger for included and deferred formalization requirements. |
| `001-yaml-surface.md` | `normative` | yes | `@shipfox/api-workflow-language` | Author-facing YAML surface and compatibility constraints. |
| `002-cue-schema.md` | `normative` | yes | `@shipfox/api-workflow-language` | CUE formalization artifact for the parsed surface shape; not an accepted input format in PR1. |
| `003-expression-language.md` | `deferred` | yes | `@shipfox/api-workflow-language` | Current minimal expression IR and the deferred path toward parser, typechecker, evaluator, interpolation, and predicate/premise logic. |
| `004-core-ir.md` | `normative` | yes | `@shipfox/api-workflow-language` | Normalized workflow model consumed by static checks and runtime semantics. |
| `005-static-semantics.md` | `normative` | yes | `@shipfox/api-workflow-language` | Stable diagnostics over normalized `WorkflowIR`. |
| `006-runtime-transitions.md` | `normative` | yes | `@shipfox/api-workflows` | Pure job-level transition kernel and golden trace ownership. |
| `007-durable-execution-host.md` | `normative` | yes | `@shipfox/api-workflows` | Temporal and persistence adapter responsibilities around the pure runtime kernel. |
| `008-adding-new-concepts.md` | `normative` | yes | `@shipfox/api-workflow-language` | Process for extending the formalized language/runtime without bypassing required layers. |
| `009-doc-generation.md` | `normative` | yes | `@shipfox/api-workflow-language` | How generated documentation is produced, tested, reviewed, and committed. |
| `010-future-platform-use-cases.md` | `exploratory` | no | `hand-authored` | Non-normative examples that can motivate later formalization work. |

## Generated Sections

This README is fully generated, and docs `000` through `009` contain marker-delimited generated sections. Do not hand-edit generated sections. Update the source-backed metadata in the owning package, run `turbo generate:docs --filter=@shipfox/api-workflow-language --filter=@shipfox/api-workflows`, and commit the generated Markdown with the code or doc model change.

`@shipfox/api-workflow-language` owns generated docs for the surface, CUE, expression, IR, static-semantics, process, README, and generation layers. `@shipfox/api-workflows` owns generated docs for runtime transitions and the durable execution host.

`010-future-platform-use-cases.md` is intentionally hand-authored and exploratory. Keep it non-normative unless a future formalization pass promotes a specific concept into the generated process.

## Reading Order

1. `000-requirements-ledger.md`
2. `001-yaml-surface.md`
3. `002-cue-schema.md`
4. `003-expression-language.md`
5. `004-core-ir.md`
6. `005-static-semantics.md`
7. `006-runtime-transitions.md`
8. `007-durable-execution-host.md`
9. `008-adding-new-concepts.md`
10. `009-doc-generation.md`
11. `010-future-platform-use-cases.md`
