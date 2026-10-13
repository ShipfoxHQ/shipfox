import type {ActionCache} from '#cache/types.js';
import type {ActionRunContext} from '#contract.js';
import type {ActionLog} from '#log.js';
import type {ActionOutputValues} from '#outputs.js';
import type {ActionState} from '#state.js';
import type {Tools} from '#tool-types.js';

export type ActionInputs = Readonly<Record<string, unknown>>;

export interface ActionContext<Inputs extends ActionInputs = ActionInputs> {
  /** Input values from `with:`, with defaults applied and types checked. */
  readonly inputs: Inputs;
  readonly tools: Tools;
  /**
   * Saves files from this job and restores them in a later job of the same project. The file work
   * runs in this process. Await every call before the handler returns.
   */
  readonly cache: ActionCache;
  /**
   * Sets a declared output right away, so it survives a later throw. The returned object is merged
   * over these values. Throws in the post phase, which has no outputs.
   */
  readonly setOutput: (name: string, value: unknown) => void;
  /**
   * Sets an environment variable for the later steps of the job. This step does not get it. The
   * value is not masked: call `addMask` first when it is a credential.
   */
  readonly setEnv: (name: string, value: string) => void;
  /** Puts a directory at the front of `PATH` for the later steps of the job. */
  readonly addPath: (directory: string) => void;
  /**
   * Masks a value in the logs, outputs, and annotations of the later steps of the job, and in the
   * outputs, annotations, and error message of this step. Logs this step already wrote stay as
   * they are, so do not print the value. Needs at least 8 characters. A multi-line value is masked
   * line by line, and a line shorter than 8 characters is not masked.
   */
  readonly addMask: (value: string) => void;
  /** Passes values from the main entry to the post entry of the same step. */
  readonly state: ActionState;
  readonly log: ActionLog;
  /** Fires on cancellation or timeout. */
  readonly signal: AbortSignal;
  readonly context: ActionRunContext;
}

export type ActionHandler<Inputs extends ActionInputs = ActionInputs> = (
  context: ActionContext<Inputs>,
) => ActionOutputValues | undefined | Promise<ActionOutputValues | undefined>;

// A registered symbol, so a definition made by another copy of this package is still recognized.
const actionDefinitionBrand = Symbol.for('@shipfox/actions/definition');

export interface ActionDefinition<Inputs extends ActionInputs = ActionInputs> {
  readonly handler: ActionHandler<Inputs>;
}

/**
 * Declares an action. The entry file must default-export the result:
 *
 * ```ts
 * export default defineAction(async ({inputs, tools}) => {
 *   const page = await tools.slack.call('read_thread', {channel_id: inputs.channel_id});
 *   return {message_count: (page.structured as {messages: unknown[]}).messages.length};
 * });
 * ```
 */
export function defineAction<Inputs extends ActionInputs = ActionInputs>(
  handler: ActionHandler<Inputs>,
): ActionDefinition<Inputs> {
  if (typeof handler !== 'function') {
    throw new TypeError('defineAction expects the action handler function.');
  }
  return Object.freeze({[actionDefinitionBrand]: true, handler});
}

/** True only for values made by `defineAction`, not for any object with a `handler`. */
export function isActionDefinition(value: unknown): value is ActionDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[actionDefinitionBrand] === true &&
    typeof (value as {handler?: unknown}).handler === 'function'
  );
}
