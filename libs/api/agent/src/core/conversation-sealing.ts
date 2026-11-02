import {Buffer} from 'node:buffer';
import {gunzipSync, gzipSync} from 'node:zlib';
import {AgentSessionUnavailableError} from './errors.js';
import {sessionDekManager} from './session-artifacts/composition.js';
import {openSessionBlob, sealSessionBlob} from './session-artifacts/crypto.js';

interface ConversationScope {
  workspaceId: string;
  conversationId: string;
}

export function conversationDataKey(workspaceId: string): Promise<Buffer> {
  return sessionDekManager().getPlaintextDek(workspaceId);
}

export function aadForConversationTitle(scope: ConversationScope): string {
  return JSON.stringify(['conversation_title', scope.workspaceId, scope.conversationId]);
}

export function aadForConversationItem(scope: ConversationScope & {itemId: string}): string {
  return JSON.stringify([
    'conversation_item',
    scope.workspaceId,
    scope.conversationId,
    scope.itemId,
  ]);
}

export function aadForTurnStreamChunk(
  scope: ConversationScope & {turnId: string; modelCallIndex: number; chunkSeq: number},
): string {
  return JSON.stringify([
    'turn_stream_chunk',
    scope.workspaceId,
    scope.conversationId,
    scope.turnId,
    scope.modelCallIndex,
    scope.chunkSeq,
  ]);
}

export function sealConversationText(params: {key: Buffer; aad: string; text: string}): Buffer {
  return sealSessionBlob({
    key: params.key,
    plaintext: Buffer.from(params.text, 'utf8'),
    aad: params.aad,
  });
}

export function openConversationText(params: {key: Buffer; aad: string; sealed: Buffer}): string {
  return openSessionBlob(params).toString('utf8');
}

// Sealed bytes don't compress, so an entry is gzipped first.
export function sealConversationEntry(params: {key: Buffer; aad: string; entry: string}): Buffer {
  return sealSessionBlob({
    key: params.key,
    plaintext: gzipSync(Buffer.from(params.entry, 'utf8')),
    aad: params.aad,
  });
}

export function openConversationEntry(params: {key: Buffer; aad: string; sealed: Buffer}): string {
  const compressed = openSessionBlob(params);
  try {
    return gunzipSync(compressed).toString('utf8');
  } catch {
    throw new AgentSessionUnavailableError('decryption_failed');
  }
}
