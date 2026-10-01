export interface RunIssueLocation {
  jobKey?: string | undefined;
  step?: {key?: string | undefined; name?: string | undefined; index: number} | undefined;
  /** Where the reference sits, for example `env`, `run`, `job.if` or `action.with`. */
  field: string;
  envKey?: string | undefined;
}

export interface RunIssueTrigger {
  source: string;
  event?: string | undefined;
  name?: string | undefined;
}

/**
 * What an issue does when a run happens: `blocks-start` refuses the run, `fails-job` lets it
 * start and fails a job later.
 */
export type RunIssueEffect = 'blocks-start' | 'fails-job';

export type RunIssue =
  | {
      kind: 'variable-missing';
      key: string;
      locations: RunIssueLocation[];
      moreLocations?: number | undefined;
      effect: RunIssueEffect;
    }
  | {
      kind: 'secret-missing';
      key: string;
      locations: RunIssueLocation[];
      moreLocations?: number | undefined;
      effect: RunIssueEffect;
    }
  | {kind: 'trigger-secret-missing'; key: string; trigger: RunIssueTrigger}
  | {
      kind: 'secret-input-unmapped';
      key: string;
      trigger: RunIssueTrigger;
      locations: RunIssueLocation[];
      moreLocations?: number | undefined;
    }
  | {
      kind: 'integration-unavailable';
      connection?: string | undefined;
      locations: RunIssueLocation[];
      moreLocations?: number | undefined;
      effect: RunIssueEffect;
    }
  | {
      kind: 'agent-config-invalid';
      model?: string | undefined;
      locations: RunIssueLocation[];
      moreLocations?: number | undefined;
      effect: RunIssueEffect;
    };

export type CopySegment = {kind: 'text'; value: string} | {kind: 'code'; value: string};

/**
 * `to` is an app route with a `$workspaceSlug` parameter, except when `external` is set: then it
 * is the server-provided `url` of a required action.
 */
export type IssueAction =
  | {
      kind: 'link';
      label: string;
      to: string;
      search?: Record<string, string> | undefined;
      external?: boolean | undefined;
    }
  | {kind: 'refresh'; label: string};

export interface IssueCopy {
  title: string;
  message: CopySegment[];
  action?: IssueAction | undefined;
}

const PREDICATE_FIELD_NAMES: Record<string, string> = {
  'job.if': 'if',
  'job.success': 'success',
  'job.listening.filter': 'filter',
  'step.if': 'if',
  'step.gate.success': 'success',
};

const LEADING_THE = /^The /;
const VARIABLES_PATH = '/w/$workspaceSlug/settings/variables';
const SECRETS_PATH = '/w/$workspaceSlug/settings/secrets';
const INTEGRATIONS_PATH = '/w/$workspaceSlug/settings/integrations';
const AI_PROVIDERS_PATH = '/w/$workspaceSlug/settings/agents';

const VARIABLE_RULE =
  "Every variable a workflow references must exist, even in a branch that doesn't run.";

function text(value: string): CopySegment {
  return {kind: 'text', value};
}

function code(value: string): CopySegment {
  return {kind: 'code', value};
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function stepLabel(step: NonNullable<RunIssueLocation['step']>): string {
  return step.key ?? step.name ?? `#${step.index}`;
}

function locationSegments(location: RunIssueLocation): CopySegment[] {
  const predicate = PREDICATE_FIELD_NAMES[location.field];
  if (predicate !== undefined) {
    const {jobKey, step} = location;
    const onJob = jobKey === undefined ? [] : [text(' in job '), code(jobKey)];
    if (step === undefined) {
      return [
        text('The '),
        code(predicate),
        ...(jobKey === undefined ? [] : [text(' on job '), code(jobKey)]),
      ];
    }
    return [text('The '), code(predicate), text(' on step '), code(stepLabel(step)), ...onJob];
  }
  const field =
    location.envKey === undefined ? location.field : `${location.field}.${location.envKey}`;
  if (location.jobKey === undefined) return [code(field)];
  return [
    text('Job '),
    code(location.jobKey),
    ...(location.step === undefined ? [] : [text(', step '), code(stepLabel(location.step))]),
    text(', '),
    code(field),
  ];
}

interface LocatedIssue {
  locations: RunIssueLocation[];
  moreLocations?: number | undefined;
}

/**
 * The subject of a sentence about where an issue sits: the first location, plus a count of the
 * rest. The returned verb agrees with it.
 */
function placesSubject(issue: LocatedIssue): {subject: CopySegment[]; plural: boolean} {
  const [first] = issue.locations;
  if (first === undefined) return {subject: [text('A step')], plural: false};
  const others = issue.locations.length - 1 + (issue.moreLocations ?? 0);
  if (others === 0) return {subject: locationSegments(first), plural: false};
  return {
    subject: [...locationSegments(first), text(` and ${plural(others, 'other place')}`)],
    plural: true,
  };
}

function reads(issue: LocatedIssue, object: CopySegment[]): CopySegment[] {
  const {subject, plural: isPlural} = placesSubject(issue);
  return [...subject, text(isPlural ? ' read ' : ' reads '), ...object];
}

function triggerLabel(trigger: RunIssueTrigger): string {
  return trigger.name ?? trigger.event ?? trigger.source;
}

function usesIt(issue: LocatedIssue): CopySegment[] {
  const {subject, plural: isPlural} = placesSubject(issue);
  return [...subject, text(isPlural ? ' use it.' : ' uses it.')];
}

export function runIssueCopy(issue: RunIssue): IssueCopy {
  switch (issue.kind) {
    case 'variable-missing':
      return {
        title: `Variable ${issue.key} is not set`,
        message: [...reads(issue, [text('it.')]), text(` ${VARIABLE_RULE}`)],
        action: {
          kind: 'link',
          label: 'Add variable',
          to: VARIABLES_PATH,
          search: {create: issue.key},
        },
      };
    case 'secret-missing':
      return {
        title: `Secret ${issue.key} is not set`,
        message: [
          ...reads(issue, [text('it.')]),
          text(' The run will start, and this step will fail.'),
        ],
        action: {kind: 'link', label: 'Add secret', to: SECRETS_PATH, search: {create: issue.key}},
      };
    case 'trigger-secret-missing':
      return {
        title: `Secret ${issue.key} is not set`,
        message: [
          text('The '),
          code(triggerLabel(issue.trigger)),
          text(' trigger passes it to the workflow.'),
        ],
        action: {kind: 'link', label: 'Add secret', to: SECRETS_PATH, search: {create: issue.key}},
      };
    case 'secret-input-unmapped':
      return {
        title: `Secret input ${issue.key} is not passed`,
        message: [
          ...reads(issue, [code(`secrets.inputs.${issue.key}`)]),
          text(', but the '),
          code(triggerLabel(issue.trigger)),
          text(" trigger doesn't pass it. Add it to the trigger's "),
          code('secrets:'),
          text(' in the workflow file.'),
        ],
      };
    case 'integration-unavailable':
      return {
        title:
          issue.connection === undefined
            ? 'An integration is not connected'
            : `Integration ${issue.connection} is not connected`,
        message: usesIt(issue),
        action: {kind: 'link', label: 'Open integrations', to: INTEGRATIONS_PATH},
      };
    case 'agent-config-invalid':
      return {
        title:
          issue.model === undefined
            ? 'Agent configuration is not valid'
            : `Model ${issue.model} is not available`,
        message: usesIt(issue),
        action: {kind: 'link', label: 'Open AI providers', to: AI_PROVIDERS_PATH},
      };
  }
}

const FALLBACK_COPY: IssueCopy = {
  title: 'Could not start the run',
  message: [text('Try again in a moment.')],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The shape of an `ApiError`, which core cannot import. */
interface StartError {
  code: string;
  details?: unknown;
}

function isStartError(error: unknown): error is StartError {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

/** The `details` of a refused start: the API body is `{code, message, details}`. */
function startDetails(error: StartError): Record<string, unknown> {
  if (!isRecord(error.details)) return {};
  const {details} = error.details;
  return isRecord(details) ? details : {};
}

function stringField(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(details: Record<string, unknown>, key: string): number | undefined {
  const value = details[key];
  return typeof value === 'number' ? value : undefined;
}

function stepField(details: Record<string, unknown>): RunIssueLocation['step'] {
  const {step} = details;
  if (!isRecord(step) || typeof step.index !== 'number') return undefined;
  return {
    index: step.index,
    ...(typeof step.key === 'string' ? {key: step.key} : {}),
    ...(typeof step.name === 'string' ? {name: step.name} : {}),
  };
}

function locationFromDetails(
  details: Record<string, unknown>,
  fallbackField: string,
): RunIssueLocation {
  return {
    field: stringField(details, 'field') ?? fallbackField,
    ...(stringField(details, 'job_key') === undefined
      ? {}
      : {jobKey: stringField(details, 'job_key')}),
    ...(stepField(details) === undefined ? {} : {step: stepField(details)}),
    ...(stringField(details, 'env_key') === undefined
      ? {}
      : {envKey: stringField(details, 'env_key')}),
  };
}

function hasLocation(details: Record<string, unknown>): boolean {
  return stringField(details, 'job_key') !== undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function sizeMessage(details: Record<string, unknown>, subject: string): CopySegment[] {
  const measured = numberField(details, 'measured_bytes');
  const limit = numberField(details, 'limit_bytes');
  if (measured === undefined || limit === undefined)
    return [text(`${subject} is over the size limit.`)];
  return [text(`${subject} is ${formatBytes(measured)}. The limit is ${formatBytes(limit)}.`)];
}

function interpolationCopy(details: Record<string, unknown>): IssueCopy {
  const variableKey = stringField(details, 'variable_key');
  if (variableKey !== undefined) {
    return runIssueCopy({
      kind: 'variable-missing',
      key: variableKey,
      locations: [locationFromDetails(details, 'env')],
      effect: 'blocks-start',
    });
  }
  const source = stringField(details, 'source');
  const where = locationSegments(locationFromDetails(details, 'env'))
    .map((segment) => segment.value)
    .join('')
    .replace(LEADING_THE, 'the ');
  return {
    title: `A value in ${where} could not be resolved`,
    message: [
      source === undefined ? text('The value') : code(source),
      text(' could not be resolved when the run started.'),
    ],
  };
}

function admissionCopy(details: Record<string, unknown>): IssueCopy {
  const action = isRecord(details.required_action) ? details.required_action : undefined;
  const reason = stringField(details, 'reason');
  const message = action === undefined ? undefined : stringField(action, 'message');
  const url = action === undefined ? undefined : stringField(action, 'url');
  const intent = action === undefined ? undefined : stringField(action, 'intent');
  return {
    title: message ?? 'Runs are paused for this workspace',
    message: reason === undefined ? [] : [text(reason)],
    ...(url === undefined
      ? {}
      : {
          action: {
            kind: 'link' as const,
            label: intent === 'contact-support' ? 'Contact support' : 'Open',
            to: url,
            external: true,
          },
        }),
  };
}

function startErrorCopyByCode(error: StartError): IssueCopy {
  const details = startDetails(error);
  switch (error.code) {
    case 'workflow-interpolation-unresolvable':
      return interpolationCopy(details);
    case 'secret-not-found': {
      const key = stringField(details, 'key');
      if (key === undefined) return FALLBACK_COPY;
      return runIssueCopy({kind: 'trigger-secret-missing', key, trigger: {source: 'manual'}});
    }
    case 'secret-input-missing': {
      const key = stringField(details, 'key');
      if (key === undefined) return FALLBACK_COPY;
      return runIssueCopy({
        kind: 'secret-input-unmapped',
        key,
        trigger: {source: 'manual'},
        locations: [],
      });
    }
    case 'agent-config-unresolvable':
      return runIssueCopy({
        kind: 'agent-config-invalid',
        model: stringField(details, 'model'),
        locations: hasLocation(details) ? [locationFromDetails(details, 'agent.model')] : [],
        effect: 'blocks-start',
      });
    case 'agent-integration-materialization-failed':
      return runIssueCopy({kind: 'integration-unavailable', locations: [], effect: 'blocks-start'});
    case 'invalid-job-runner-labels': {
      const labels = Array.isArray(details.labels)
        ? details.labels.filter((label): label is string => typeof label === 'string')
        : [];
      return {
        title: 'Runner labels are not valid',
        message: [
          ...(labels.length === 0 ? [text('Some labels')] : [code(labels.join(', '))]),
          text(' are not valid runner labels. Use lowercase letters, digits, '),
          code('.'),
          text(', '),
          code('_'),
          text(' and '),
          code('-'),
          text('.'),
        ],
      };
    }
    case 'source-snapshot-too-large':
      return {title: 'Workflow file is too large', message: sizeMessage(details, 'It')};
    case 'workflow-execution-payload-too-large': {
      const field = stringField(details, 'field');
      return {
        title: field === undefined ? 'A value is too large' : `${field} is too large`,
        message: sizeMessage(details, 'Its resolved value'),
      };
    }
    case 'admission-denied':
      return admissionCopy(details);
    case 'workspace-suspended':
      return {
        title: 'Workspace suspended',
        message: [text("Runs can't start until the workspace is active again.")],
      };
    case 'manual-trigger-not-found':
    case 'definition-not-found':
      return {
        title: 'This workflow changed',
        message: [
          text(
            'It no longer has a manual trigger, or it was removed. Refresh to see the latest version.',
          ),
        ],
        action: {kind: 'refresh', label: 'Refresh'},
      };
    case 'workspace-not-found':
    case 'workspace-deleted':
      return {
        title: 'Workspace unavailable',
        message: [text('This workspace no longer exists.')],
      };
    case 'project-mismatch':
      return {
        title: 'Workflow configuration is inconsistent',
        message: [text('The trigger points to a workflow in another project.')],
      };
    default:
      return FALLBACK_COPY;
  }
}

/**
 * User-facing copy for a refused run start. It reads the error `code` and `details` and never
 * renders `ApiError.message`, so an unknown failure shows the fallback.
 */
export function runStartErrorCopy(error: unknown): IssueCopy {
  if (!isStartError(error)) return FALLBACK_COPY;
  return startErrorCopyByCode(error);
}
