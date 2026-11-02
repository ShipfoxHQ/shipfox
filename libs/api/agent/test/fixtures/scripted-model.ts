import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type {
  CreateModelRuntime,
  ModelCallRuntime,
  ModelRuntimeParams,
} from '#core/turn-runtime/model-runtime.js';

export type ScriptedReply = AssistantMessage | ((context: Context) => AssistantMessage);

/**
 * A model that answers from a script, one reply per request. It records what each request
 * carried, so tests can compare the prompts two calls sent.
 */
export function createScriptedModel(replies: ScriptedReply[]) {
  const requests: {context: Context; options: SimpleStreamOptions; params: ModelRuntimeParams}[] =
    [];
  let next = 0;

  const createModelRuntime: CreateModelRuntime = (params) => {
    const runtime: ModelCallRuntime = {
      model: {contextWindow: 200_000} as ModelCallRuntime['model'],
      thinking: 'default',
      stream: (context, options) => {
        requests.push({context: structuredClone(context), options, params});
        const reply = replies[next++];
        if (reply === undefined) throw new Error('The scripted model has no reply left');
        const message = typeof reply === 'function' ? reply(context) : reply;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          for (const [contentIndex, block] of message.content.entries()) {
            if (block.type === 'text') {
              stream.push({
                type: 'text_delta',
                contentIndex,
                delta: block.text,
                partial: message,
              });
            }
          }
          stream.push(
            message.stopReason === 'error'
              ? {type: 'error', reason: 'error', error: message}
              : {type: 'done', reason: message.stopReason as 'stop', message},
          );
          stream.end();
        });
        return stream;
      },
    };
    return Promise.resolve(runtime);
  };

  return {createModelRuntime, requests};
}

export function textReply(text: string): AssistantMessage {
  return fauxAssistantMessage(text, {stopReason: 'stop'});
}
