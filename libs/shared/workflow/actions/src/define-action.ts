import type {ActionRunContext} from '#contract.js';
import type {ActionLog} from '#log.js';
import type {ActionOutputValues} from '#outputs.js';
import type {Tools} from '#tools-client.js';

export type ActionInputs = Readonly<Record<string, unknown>>;

export interface ActionContext<Inputs extends ActionInputs = ActionInputs> {
  /** Input values from `with:`, with defaults applied and types checked. */
  readonly inputs: Inputs;
  readonly tools: Tools;
  /**
   * Sets a declared output right away, so it survives a later throw. The returned object is merged
   * over these values.
   */
  readonly setOutput: (name: string, value: unknown) => void;
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
