import {resolve} from 'node:path';
import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import {E2eApiError, preflightCheck} from '@shipfox/e2e-core';
import {
  createClickUpConnection,
  createDiscordConnection,
  createJiraConnection,
  createLinearConnection,
  createSentryConnection,
  createSlackConnection,
} from '@shipfox/e2e-setup-integrations';
import {
  shippedTemplateLoader,
  type TemplateLoader,
  type TemplateOptions,
  type TemplateRoleBindings,
  templateVariants,
  type WorkflowTemplate,
} from '@shipfox/workflow-templates';
import {createDirectoryTemplateLoader} from '@shipfox/workflow-templates/testing';
import {parse as parseYaml} from 'yaml';
import {matchesCase} from './discovery.js';
import {arrangeGithubProject} from './github-project.js';
import {type CaseResult, createRunId, type ResultsRun, writeResults} from './results.js';

const STANDALONE_SLOT_MARKER = /^(\s*)# slot:([A-Za-z0-9_-]+)\s*$/gmu;
const INLINE_SLOT_MARKER = /# slot:([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/gu;
const SLOT_PLACEHOLDER = /replace-with-[A-Za-z0-9_-]+/gu;
const SLOT_COMMAND = 'echo slot-placeholder';
// The placeholder connection name a template writes, such as `linear_tracker`, and the role it binds.
const BOUND_CONNECTION =
  /^(.*\b(?:source|connection):\s*)([A-Za-z0-9_-]+)(\s+# bind:([A-Za-z0-9_-]+)\s*)$/u;

export interface CompileVariant {
  /** `<template>/<bindings and changed options>`, unique across the variants of one loader. */
  id: string;
  template: WorkflowTemplate;
  bindings: TemplateRoleBindings;
  options: TemplateOptions;
}

function variantLabel({
  bindings,
  options,
  defaults,
}: {
  bindings: TemplateRoleBindings;
  options: TemplateOptions;
  defaults: TemplateOptions;
}): string {
  const parts = [
    ...Object.entries(bindings).map(([role, provider]) => `${role}=${provider}`),
    ...Object.entries(options)
      .filter(([option, choice]) => choice !== defaults[option])
      .map(([option, choice]) => `${option}=${choice}`),
  ];
  return parts.length === 0 ? 'default' : parts.join(',');
}

/** Every variant the static layer composes, for the templates whose id matches `filter`. */
export async function listCompileVariants({
  loader,
  filter,
}: {
  loader: TemplateLoader;
  filter?: string | undefined;
}): Promise<CompileVariant[]> {
  const templates = await loader.list();
  return templates
    .filter((template) => matchesCase(template.id, filter))
    .flatMap((template) => {
      const variants = templateVariants(template);
      const defaults = variants[0]?.options ?? {};
      return variants.map(({bindings, options}) => ({
        id: `${template.id}/${variantLabel({bindings, options, defaults})}`,
        template,
        bindings,
        options,
      }));
    });
}

/**
 * Fills every slot and `replace-with-*` value with a placeholder that parses, the way the static
 * layer does. Compilation checks wiring, so the values only have to be well formed.
 */
export function fillTemplatePlaceholders(yaml: string): string {
  return yaml
    .replace(STANDALONE_SLOT_MARKER, `$1- run: ${SLOT_COMMAND}`)
    .replace(INLINE_SLOT_MARKER, '')
    .replace(SLOT_PLACEHOLDER, SLOT_COMMAND);
}

/**
 * Replaces the placeholder connection names, such as `linear_tracker`, with the slugs of the
 * connections the workspace holds, the way the coding agent does. `slugs` maps each role to the
 * slug of its provider's connection.
 */
export function bindConnectionSlugs({
  yaml,
  slugs,
}: {
  yaml: string;
  slugs: Readonly<Record<string, string>>;
}): string {
  return yaml
    .split('\n')
    .map((line) => {
      const [, prefix, , marker, role] = BOUND_CONNECTION.exec(line) ?? [];
      if (prefix === undefined || marker === undefined || role === undefined) return line;
      const slug = slugs[role];
      if (slug === undefined) {
        throw new Error(`The composed workflow binds role "${role}", which the variant does not.`);
      }
      return `${prefix}${slug}${marker}`;
    })
    .join('\n');
}

interface Matcher {
  source: string;
  event?: string | undefined;
}

interface AuthoredDocument {
  triggers?: Record<string, Matcher>;
  jobs?: Record<string, {listening?: {on?: Matcher[]; until?: Matcher[]}} | undefined>;
}

interface CompiledModel {
  triggers?: Array<Matcher & {key: string}>;
  jobs?: Array<{key: string; listening?: {on?: Matcher[]; until?: Matcher[]}}>;
}

// The model drops an inert matcher and keeps the order of the others, so the compiled list is
// matched against the authored one in order.
function inertMatchers({
  authored,
  compiled,
}: {
  authored: readonly Matcher[];
  compiled: readonly Matcher[];
}): number[] {
  const inert: number[] = [];
  let next = 0;
  authored.forEach((matcher, index) => {
    const candidate = compiled[next];
    const matches =
      candidate !== undefined &&
      candidate.source === matcher.source &&
      (matcher.event === undefined || candidate.event === matcher.event.trim());
    if (matches) next += 1;
    else inert.push(index);
  });
  return inert;
}

function describeMatcher({source, event}: Matcher): string {
  return event === undefined ? source : `${source} ${event}`;
}

function inactiveTriggers({
  authored,
  model,
}: {
  authored: AuthoredDocument;
  model: CompiledModel;
}): string[] {
  return Object.entries(authored.triggers ?? {})
    .filter(([key]) => !model.triggers?.some((candidate) => candidate.key === key))
    .map(([key, trigger]) => `Trigger "${key}" (${describeMatcher(trigger)}) is not active.`);
}

function inactiveListeningMatchers({
  authored,
  model,
}: {
  authored: AuthoredDocument;
  model: CompiledModel;
}): string[] {
  return Object.entries(authored.jobs ?? {}).flatMap(([jobKey, job]) => {
    const compiled = model.jobs?.find((candidate) => candidate.key === jobKey)?.listening;
    return (['on', 'until'] as const).flatMap((field) => {
      const matchers = job?.listening?.[field] ?? [];
      return inertMatchers({authored: matchers, compiled: compiled?.[field] ?? []}).map(
        (index) =>
          `Job "${jobKey}" listening.${field}[${index}] (${describeMatcher(matchers[index] ?? {source: '?'})}) is not active.`,
      );
    });
  });
}

/**
 * What is wrong with a compiled definition. Creating a definition succeeds when a trigger is
 * broken. The endpoint stores that trigger as inert and reports it in the diagnostics, so this
 * requires zero error diagnostics and every authored trigger, listening `on` matcher, and `until`
 * matcher to be active in the model.
 */
export function checkCompiledDefinition({
  yaml,
  definition,
}: {
  yaml: string;
  definition: Pick<DefinitionResponseDto, 'diagnostics' | 'workflow_model'>;
}): string[] {
  const diagnostics = (definition.diagnostics ?? [])
    .filter(({severity}) => severity === 'error')
    .map(
      ({code, path, message}) =>
        `Error diagnostic ${code}${path === undefined ? '' : ` at ${path}`}: ${message}`,
    );
  const authored = (parseYaml(yaml) ?? {}) as AuthoredDocument;
  const model = (definition.workflow_model ?? {}) as CompiledModel;
  return [
    ...diagnostics,
    ...inactiveTriggers({authored, model}),
    ...inactiveListeningMatchers({authored, model}),
  ];
}

/** Creates the workspace's connection to one provider, and returns its slug. */
async function createProviderConnection({
  provider,
  workspaceId,
  uniqueId,
}: {
  provider: string;
  workspaceId: string;
  uniqueId: string;
}): Promise<string> {
  switch (provider) {
    case 'linear':
      return (
        await createLinearConnection({
          workspaceId,
          organizationId: `eval-org-${uniqueId}`,
          organizationUrlKey: `eval-${uniqueId}`,
          appUserId: `eval-app-${uniqueId}`,
          displayName: `Eval Linear ${uniqueId}`,
          accessToken: `lin_oauth_${uniqueId}`,
        })
      ).slug;
    case 'slack':
      return (
        await createSlackConnection({
          workspaceId,
          teamId: `T${uniqueId}`,
          teamName: `Eval Slack ${uniqueId}`,
          appId: `A${uniqueId}`,
          botUserId: `Ubot${uniqueId}`,
          botToken: 'xoxb-eval-slack-bot-token',
        })
      ).slug;
    case 'discord':
      return (
        await createDiscordConnection({
          workspaceId,
          guildId: `guild-${uniqueId}`,
          guildName: `Eval Discord ${uniqueId}`,
        })
      ).slug;
    case 'clickup':
      return (
        await createClickUpConnection({
          workspaceId,
          teamId: `team-${uniqueId}`,
          teamName: `Eval ClickUp ${uniqueId}`,
          authorizingUserId: `eval-user-${uniqueId}`,
          accessToken: `clickup-access-token-${uniqueId}`,
          webhookId: `webhook-${uniqueId}`,
          webhookSecret: `secret-${uniqueId}`,
          displayName: `Eval ClickUp ${uniqueId}`,
        })
      ).slug;
    case 'jira':
      return (
        await createJiraConnection({
          workspaceId,
          cloudId: `eval-cloud-${uniqueId}`,
          siteUrl: `https://eval-${uniqueId}.atlassian.example.test`,
          siteName: `Eval Jira ${uniqueId}`,
          authorizingAccountId: `eval-account-${uniqueId}`,
          displayName: `Eval Jira ${uniqueId}`,
          accessToken: `jira-access-token-${uniqueId}`,
        })
      ).slug;
    case 'sentry':
      return (
        await createSentryConnection({
          workspaceId,
          installationUuid: `eval-installation-${uniqueId}`,
          orgSlug: `eval-${uniqueId}`,
          displayName: `Eval Sentry ${uniqueId}`,
          accessToken: `sentry-access-token-${uniqueId}`,
        })
      ).slug;
    default:
      throw new Error(`No E2E connection route creates a "${provider}" connection.`);
  }
}

// A rejected definition explains itself in the response body, not in the status.
function failureMessage(error: unknown): string {
  if (error instanceof E2eApiError && error.details !== undefined) {
    return `${error.message}\n${JSON.stringify(error.details)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface VariantCompiler {
  compile(variant: CompileVariant): Promise<CaseResult>;
}

/**
 * One workspace and project for every variant, with a connection for each provider a variant
 * binds, created when the first variant needs it. Compilation checks each connection against the
 * workspace, so a variant needs the same connections a user would have.
 */
export async function createVariantCompiler({
  loader,
  cleanups,
}: {
  loader: TemplateLoader;
  cleanups: Array<() => Promise<void>>;
}): Promise<VariantCompiler> {
  const {uniqueId, workspace, client, connection, project} = await arrangeGithubProject({
    label: 'compile',
    cleanups,
  });
  const slugs = new Map<string, string>([['github', connection.slug]]);

  const slugOf = async (provider: string): Promise<string> => {
    const known = slugs.get(provider);
    if (known !== undefined) return known;
    const slug = await createProviderConnection({
      provider,
      workspaceId: workspace.id,
      uniqueId,
    });
    slugs.set(provider, slug);
    return slug;
  };

  return {
    compile: async (variant) => {
      const startedAt = Date.now();
      const result: CaseResult = {
        case: variant.id,
        mode: 'compile',
        repeat: 1,
        status: 'error',
        duration_ms: 0,
        cost_usd: 0,
      };
      try {
        const composed = await loader.compose({
          package: variant.template.package,
          bindings: variant.bindings,
          options: variant.options,
        });
        if (composed === undefined) {
          throw new Error(`The template loader does not serve ${variant.template.package}.`);
        }
        const bySlug: Record<string, string> = {};
        for (const [role, provider] of Object.entries(variant.bindings)) {
          bySlug[role] = await slugOf(provider);
        }
        const yaml = bindConnectionSlugs({yaml: fillTemplatePlaceholders(composed), slugs: bySlug});
        result.composed_yaml = yaml;

        const definition = await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
          json: {project_id: project.id, source: 'manual', yaml},
        });
        const problems = checkCompiledDefinition({yaml, definition});
        if (problems.length === 0) result.status = 'passed';
        else result.error = problems.join('\n');
      } catch (error) {
        result.error = failureMessage(error);
      }
      result.duration_ms = Date.now() - startedAt;
      return result;
    },
  };
}

export interface CompileRunOptions {
  /** Compiles the templates whose id matches, all of them when unset. */
  caseFilter?: string;
  /** A catalog directory to compile instead of the shipped templates, relative to `cwd`. */
  catalog?: string;
  cwd?: string;
  resultsDirectory?: string;
  runId?: string;
  /** Replaces compilation against the running stack, which tests don't have. */
  compile?: (variant: CompileVariant) => Promise<CaseResult>;
}

/** Compiles every variant of every template on the running stack and writes the results. */
export async function runCompile(options: CompileRunOptions = {}): Promise<ResultsRun> {
  const cwd = options.cwd ?? process.cwd();
  const loader =
    options.catalog === undefined
      ? shippedTemplateLoader
      : createDirectoryTemplateLoader(resolve(cwd, options.catalog));
  const variants = await listCompileVariants({loader, filter: options.caseFilter});
  if (variants.length === 0) {
    const selected = options.caseFilter ? ` matching "${options.caseFilter}"` : '';
    throw new Error(`No template variants${selected} were found.`);
  }

  const cleanups: Array<() => Promise<void>> = [];
  try {
    let compile = options.compile;
    if (compile === undefined) {
      await preflightCheck({requireClient: false});
      const compiler = await createVariantCompiler({loader, cleanups});
      compile = compiler.compile;
    }
    const compileVariant = compile;
    return await writeResults({
      cases: variants,
      mode: 'compile',
      repeat: 1,
      execute: ({discovered}) => compileVariant(discovered),
      runId: options.runId ?? createRunId(),
      ...(options.resultsDirectory === undefined
        ? {}
        : {resultsDirectory: options.resultsDirectory}),
    });
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
  }
}
