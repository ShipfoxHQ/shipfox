import {randomBytes} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {
  claimQueuedConversationItems,
  getRunningTurn,
  listConversationTimeline,
  loadWebConversation,
} from '#db/conversations.js';
import {db} from '#db/db.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {conversations} from '#db/schema/conversations.js';
import {turnStreamChunks} from '#db/schema/turn-stream-chunks.js';
import {turns} from '#db/schema/turns.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {appendConversationEntry} from '#test/fixtures/conversation-entries.js';
import {
  CONVERSATION_SESSION_VERSION,
  conversationPageNote,
  userMessageEntry,
} from './conversation-entries.js';
import {
  aadForConversationItem,
  aadForConversationTitle,
  aadForTurnStreamChunk,
  conversationDataKey,
  openConversationText,
  sealConversationText,
} from './conversation-sealing.js';
import {
  conversationTitleFromMessage,
  createWebConversation,
  deleteWebConversation,
  listOpenConversationItems,
  postWebConversationMessage,
} from './conversations.js';
import type {OpenConversationItem} from './entities/conversation.js';
import {ConversationNotFoundError, ConversationTurnRunningError} from './errors.js';

function storedContent(item: OpenConversationItem): Array<{type: string; text: string}> {
  return JSON.parse(item.entry as string).message.content;
}

function storedText(item: OpenConversationItem): string | undefined {
  return item.entry === null ? undefined : storedContent(item)[0]?.text;
}

async function requireConversation(conversationId: string, userId: string) {
  const conversation = await loadWebConversation({conversationId, userId});
  if (!conversation) throw new Error('Conversation not found');
  return conversation;
}

describe('conversationTitleFromMessage', () => {
  it('keeps the start of the message on one line', () => {
    const title = conversationTitleFromMessage('  Why did\n\nthis   fail?  ');

    expect(title).toBe('Why did this fail?');
  });

  it('never splits a character', () => {
    const title = conversationTitleFromMessage('🦊'.repeat(100));

    expect(Array.from(title)).toHaveLength(80);
    expect(title).toBe('🦊'.repeat(80));
  });
});

describe('userMessageEntry', () => {
  const runId = '11111111-1111-4111-8111-111111111111';

  it('stores a pi message entry with the text as its only block', () => {
    const entry = JSON.parse(userMessageEntry({body: 'Hello'}));

    expect(entry).toEqual({
      type: 'message',
      timestamp: expect.any(String),
      message: {
        role: 'user',
        content: [{type: 'text', text: 'Hello'}],
        timestamp: expect.any(Number),
      },
    });
  });

  it('adds the page note as the second block', () => {
    const pageContext = {page: 'run' as const, run_id: runId, attempt: 2};

    const entry = JSON.parse(userMessageEntry({body: 'Why?', pageContext}));

    expect(entry.message.content).toEqual([
      {type: 'text', text: 'Why?'},
      {type: 'text', text: `<page_context page="run" run_id="${runId}" attempt="2"/>`},
    ]);
  });

  it('leaves the status out of the note', () => {
    const note = conversationPageNote({page: 'run', run_id: runId, status: 'failed'});

    expect(note).toBe(`<page_context page="run" run_id="${runId}"/>`);
  });

  it('writes a note for a page with no fields', () => {
    const note = conversationPageNote({page: 'runs'});

    expect(note).toBe('<page_context page="runs"/>');
  });
});

describe('sealed conversation data', () => {
  const secret = 'the-plaintext-marker';

  it('stores no plaintext title or body', async () => {
    const {conversation, item} = await conversationFactory.create({body: `${secret} in a message`});

    const [conversationRow] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    const [itemRow] = await db()
      .select()
      .from(conversationItems)
      .where(eq(conversationItems.id, item.id));

    expect(conversation.title).toBe(`${secret} in a message`);
    expect(storedText(item)).toBe(`${secret} in a message`);
    expect(conversationRow?.title?.toString('latin1')).not.toContain(secret);
    expect(itemRow?.body.toString('latin1')).not.toContain(secret);
    expect(JSON.stringify(itemRow?.meta)).not.toContain(secret);
  });

  it('stores no plaintext stream chunk', async () => {
    const {conversation} = await conversationFactory.create();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const key = await conversationDataKey(conversation.workspaceId);
    const aad = aadForTurnStreamChunk({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      turnId: turn.id,
      modelCallIndex: 0,
      chunkSeq: 0,
    });
    await db()
      .insert(turnStreamChunks)
      .values({
        turnId: turn.id,
        modelCallIndex: 0,
        chunkSeq: 0,
        body: sealConversationText({key, aad, text: secret}),
      });

    const [row] = await db()
      .select()
      .from(turnStreamChunks)
      .where(eq(turnStreamChunks.turnId, turn.id));

    expect(row?.body.toString('latin1')).not.toContain(secret);
    expect(openConversationText({key, aad, sealed: row?.body as Buffer})).toBe(secret);
  });

  it.each([
    {
      name: 'an item into another conversation',
      from: aadForConversationItem({workspaceId: 'w', conversationId: 'a', itemId: 'i'}),
      to: aadForConversationItem({workspaceId: 'w', conversationId: 'b', itemId: 'i'}),
    },
    {
      name: 'a title into another workspace',
      from: aadForConversationTitle({workspaceId: 'a', conversationId: 'c'}),
      to: aadForConversationTitle({workspaceId: 'b', conversationId: 'c'}),
    },
    {
      name: 'an item into a title',
      from: aadForConversationItem({workspaceId: 'w', conversationId: 'c', itemId: 'i'}),
      to: aadForConversationTitle({workspaceId: 'w', conversationId: 'c'}),
    },
  ])('refuses to open $name', ({from, to}) => {
    const key = randomBytes(32);
    const sealed = sealConversationText({key, aad: from, text: 'text'});

    const open = () => openConversationText({key, aad: to, sealed});

    expect(open).toThrow();
  });
});

describe('createWebConversation', () => {
  it('returns the stored conversation for a repeated create', async () => {
    const params = conversationFactory.build();
    const first = await createWebConversation(params);

    const repeat = await createWebConversation(params);

    const rows = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, params.projectId));
    expect(repeat.conversation.id).toBe(first.conversation.id);
    expect(repeat.item.id).toBe(first.item.id);
    expect(storedText(repeat.item)).toBe(params.body);
    expect(rows).toHaveLength(1);
  });

  it('opens one conversation for concurrent creates', async () => {
    const params = conversationFactory.build();

    const results = await Promise.all([1, 2, 3].map(() => createWebConversation(params)));

    const rows = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, params.projectId));
    const items = await db()
      .select()
      .from(conversationItems)
      .where(eq(conversationItems.conversationId, results[0]?.conversation.id as string));
    expect(new Set(results.map((result) => result.conversation.id)).size).toBe(1);
    expect(rows).toHaveLength(1);
    expect(items).toHaveLength(1);
  });

  it.each([
    {name: 'another owner', change: {ownerUserId: crypto.randomUUID()}},
    {name: 'another project', change: {projectId: crypto.randomUUID()}},
  ])('keeps the same client message id apart for $name', async ({change}) => {
    const params = conversationFactory.build();
    const first = await createWebConversation(params);

    const other = await createWebConversation({...params, ...change});

    expect(other.conversation.id).not.toBe(first.conversation.id);
  });

  it('opens a new conversation after the first one is deleted', async () => {
    const params = conversationFactory.build();
    const first = await createWebConversation(params);
    await deleteWebConversation(first.conversation.id);

    const second = await createWebConversation(params);

    expect(second.conversation.id).not.toBe(first.conversation.id);
  });
});

describe('postWebConversationMessage', () => {
  it('queues the message with a null seq', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});

    const item = await postWebConversationMessage({
      conversation: await requireConversation(conversation.id, owner),
      authorUserId: owner,
      clientMessageId: crypto.randomUUID(),
      body: 'second',
    });

    expect(item.seq).toBeNull();
    expect(item.entryType).toBe('message');
    expect(item.sessionVersion).toBe(CONVERSATION_SESSION_VERSION);
    expect(item.meta).toEqual({role: 'user'});
    expect(item.authorUserId).toBe(owner);
  });

  it('gives the run budget back, and only for a new message', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);
    const clientMessageId = crypto.randomUUID();
    const budget = async () =>
      (
        await db()
          .select({value: conversations.runStartsSinceHuman})
          .from(conversations)
          .where(eq(conversations.id, conversation.id))
      )[0]?.value;
    const spend = async (count: number) =>
      await db()
        .update(conversations)
        .set({runStartsSinceHuman: count})
        .where(eq(conversations.id, conversation.id));
    await spend(5);

    await postWebConversationMessage({
      conversation: loaded,
      authorUserId: owner,
      clientMessageId,
      body: 'go on',
    });
    const afterMessage = await budget();
    await spend(2);
    await postWebConversationMessage({
      conversation: loaded,
      authorUserId: owner,
      clientMessageId,
      body: 'go on',
    });
    const afterRepeat = await budget();

    expect(afterMessage).toBe(0);
    expect(afterRepeat).toBe(2);
  });

  it('dedupes a repeated post on its client message id', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);
    const clientMessageId = crypto.randomUUID();
    const first = await postWebConversationMessage({
      conversation: loaded,
      authorUserId: owner,
      clientMessageId,
      body: 'once',
    });
    const before = await requireConversation(conversation.id, owner);

    const repeats = await Promise.all(
      [1, 2, 3].map(() =>
        postWebConversationMessage({
          conversation: loaded,
          authorUserId: owner,
          clientMessageId,
          body: 'once',
        }),
      ),
    );

    const {queued} = await listOpenConversationItems({conversation: loaded, limit: 50});
    const after = await requireConversation(conversation.id, owner);
    expect(after.lastActivityAt).toEqual(before.lastActivityAt);
    expect(repeats.map((repeat) => repeat.id)).toEqual([first.id, first.id, first.id]);
    expect(queued.filter((item) => item.clientMessageId === clientMessageId)).toHaveLength(1);
  });

  it('dedupes against the first message of the conversation', async () => {
    const owner = crypto.randomUUID();
    const {conversation, item} = await conversationFactory.create({ownerUserId: owner});

    const repeat = await postWebConversationMessage({
      conversation: await requireConversation(conversation.id, owner),
      authorUserId: owner,
      clientMessageId: item.clientMessageId as string,
      body: 'a repeat',
    });

    expect(repeat.id).toBe(item.id);
  });

  it('allows the same client message id in another conversation', async () => {
    const owner = crypto.randomUUID();
    const clientMessageId = crypto.randomUUID();
    const {item} = await conversationFactory.create({ownerUserId: owner, clientMessageId});
    const {conversation} = await conversationFactory.create({ownerUserId: owner});

    const other = await postWebConversationMessage({
      conversation: await requireConversation(conversation.id, owner),
      authorUserId: owner,
      clientMessageId,
      body: 'other',
    });

    expect(other.id).not.toBe(item.id);
  });

  it('fails for a conversation deleted after it was loaded', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);
    await deleteWebConversation(conversation.id);

    const post = postWebConversationMessage({
      conversation: loaded,
      authorUserId: owner,
      clientMessageId: crypto.randomUUID(),
      body: 'late',
    });

    await expect(post).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});

describe('claimQueuedConversationItems', () => {
  async function postMessages(params: {count: number}) {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({
      ownerUserId: owner,
      body: 'message 0',
    });
    const loaded = await requireConversation(conversation.id, owner);
    for (let index = 1; index < params.count; index += 1) {
      await postWebConversationMessage({
        conversation: loaded,
        authorUserId: owner,
        clientMessageId: crypto.randomUUID(),
        body: `message ${index}`,
      });
    }
    return {owner, conversation: loaded};
  }

  it('assigns seq in arrival order and advances last_seq', async () => {
    const {owner, conversation} = await postMessages({count: 3});

    const claimed = await claimQueuedConversationItems(conversation.id);

    const {items, queued} = await listOpenConversationItems({conversation, limit: 50});
    const reloaded = await requireConversation(conversation.id, owner);
    expect(claimed).toBe(3);
    expect(items.map((item) => [item.seq, storedText(item)])).toEqual([
      [1, 'message 0'],
      [2, 'message 1'],
      [3, 'message 2'],
    ]);
    expect(queued).toEqual([]);
    expect(reloaded.lastSeq).toBe(3);
  });

  it('continues from the last seq', async () => {
    const {owner, conversation} = await postMessages({count: 1});
    await claimQueuedConversationItems(conversation.id);
    await postWebConversationMessage({
      conversation,
      authorUserId: owner,
      clientMessageId: crypto.randomUUID(),
      body: 'later',
    });

    await claimQueuedConversationItems(conversation.id);

    const {items} = await listOpenConversationItems({conversation, limit: 50});
    expect(items.map((item) => item.seq)).toEqual([1, 2]);
  });

  it('gives two concurrent claims distinct seq values', async () => {
    const {conversation} = await postMessages({count: 4});

    const claimed = await Promise.all([
      claimQueuedConversationItems(conversation.id),
      claimQueuedConversationItems(conversation.id),
    ]);

    const {items} = await listConversationTimeline({
      conversationId: conversation.id,
      limit: 50,
      queuedLimit: 50,
    });
    expect(claimed.reduce((total, count) => total + count, 0)).toBe(4);
    expect(items.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
  });
});

describe('listOpenConversationItems', () => {
  it('shows an input exactly once while a claim lands', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);

    for (let round = 0; round < 60; round += 1) {
      const item = await postWebConversationMessage({
        conversation: loaded,
        authorUserId: owner,
        clientMessageId: crypto.randomUUID(),
        body: `round ${round}`,
      });

      const [timeline] = await Promise.all([
        listOpenConversationItems({conversation: loaded, limit: 100}),
        claimQueuedConversationItems(conversation.id),
      ]);

      const seen = [...timeline.items, ...timeline.queued].filter(({id}) => id === item.id);
      expect(seen).toHaveLength(1);
    }
  });

  it('caps queued inputs at 100 whatever the page limit, and reports the rest', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);
    for (let index = 0; index < 100; index += 1) {
      await postWebConversationMessage({
        conversation: loaded,
        authorUserId: owner,
        clientMessageId: crypto.randomUUID(),
        body: `queued ${index}`,
      });
    }

    const {queued, queuedHasMore} = await listOpenConversationItems({
      conversation: loaded,
      limit: 1,
    });

    expect(queued).toHaveLength(100);
    expect(queuedHasMore).toBe(true);
  });

  it('returns an entry byte for byte, with thinking, a signature, and an unknown block', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);
    const entry =
      '{"type":"message","zLater":1,"timestamp":"2026-11-02T00:00:00.000Z","message":{"role":"assistant",' +
      '"content":[{"type":"thinking","thinking":"hm","thinkingSignature":"sig-1"},' +
      '{"type":"future_block","payload":[1, 2],"nested":{"b":1,"a":2}}]}}';
    await appendConversationEntry({conversation, entry});

    const {items} = await listOpenConversationItems({conversation: loaded, limit: 50});

    expect(items.map((item) => item.entry)).toEqual([entry]);
  });

  it('reads an entry that is sealed but not gzipped as null', async () => {
    const owner = crypto.randomUUID();
    const {conversation, item} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);
    const key = await conversationDataKey(conversation.workspaceId);
    await db()
      .update(conversationItems)
      .set({
        body: sealConversationText({
          key,
          aad: aadForConversationItem({
            workspaceId: conversation.workspaceId,
            conversationId: conversation.id,
            itemId: item.id,
          }),
          text: 'not gzipped',
        }),
      })
      .where(eq(conversationItems.id, item.id));

    const {queued} = await listOpenConversationItems({conversation: loaded, limit: 50});

    expect(queued.map((entry) => entry.entry)).toEqual([null]);
  });

  it('reads an unreadable body as null, and keeps the other items', async () => {
    const owner = crypto.randomUUID();
    const {conversation, item} = await conversationFactory.create({ownerUserId: owner});
    const loaded = await requireConversation(conversation.id, owner);
    await postWebConversationMessage({
      conversation: loaded,
      authorUserId: owner,
      clientMessageId: crypto.randomUUID(),
      body: 'still readable',
    });
    await db()
      .update(conversationItems)
      .set({body: Buffer.from('not sealed')})
      .where(eq(conversationItems.id, item.id));

    const {queued} = await listOpenConversationItems({conversation: loaded, limit: 50});

    expect(queued.map((entry) => [entry.entry, storedText(entry)])).toEqual([
      [null, undefined],
      [expect.any(String), 'still readable'],
    ]);
  });
});

describe('deleteWebConversation', () => {
  it('removes the conversation, its items, and its finished turns', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    await turnFactory.create({conversationId: conversation.id, status: 'succeeded'});

    await deleteWebConversation(conversation.id);

    const items = await db()
      .select()
      .from(conversationItems)
      .where(eq(conversationItems.conversationId, conversation.id));
    const remainingTurns = await db()
      .select()
      .from(turns)
      .where(eq(turns.conversationId, conversation.id));
    expect(await loadWebConversation({conversationId: conversation.id, userId: owner})).toBe(
      undefined,
    );
    expect(items).toEqual([]);
    expect(remainingTurns).toEqual([]);
  });

  it('refuses during a running turn', async () => {
    const owner = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({ownerUserId: owner});
    const turn = await turnFactory.create({conversationId: conversation.id});

    const deletion = deleteWebConversation(conversation.id);

    await expect(deletion).rejects.toBeInstanceOf(ConversationTurnRunningError);
    expect((await getRunningTurn(conversation.id))?.id).toBe(turn.id);
  });
});

describe('agent_conversation_items write position', () => {
  it('allows one assistant entry per model call', async () => {
    const {conversation} = await conversationFactory.create();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const position = {turnId: turn.id, modelCallIndex: 0};
    await appendConversationEntry({conversation, entry: {type: 'message'}, ...position});

    const second = appendConversationEntry({conversation, entry: {type: 'message'}, ...position});

    await expect(second).rejects.toThrow();
  });

  it('allows one tool result per call', async () => {
    const {conversation} = await conversationFactory.create();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const position = {turnId: turn.id, modelCallIndex: 0, callIndex: 1};
    await appendConversationEntry({conversation, entry: {type: 'message'}, ...position});

    const second = appendConversationEntry({conversation, entry: {type: 'message'}, ...position});

    await expect(second).rejects.toThrow();
  });

  it('keeps an assistant entry and its tool results apart', async () => {
    const {conversation} = await conversationFactory.create();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const position = {turnId: turn.id, modelCallIndex: 0};
    await appendConversationEntry({conversation, entry: {type: 'message'}, ...position});

    const result = appendConversationEntry({
      conversation,
      entry: {type: 'message'},
      ...position,
      callIndex: 0,
    });

    await expect(result).resolves.toEqual(expect.any(String));
  });
});

describe('agent_turns', () => {
  it('allows one running turn per conversation', async () => {
    const {conversation} = await conversationFactory.create();
    await turnFactory.create({conversationId: conversation.id});

    const second = turnFactory.create({conversationId: conversation.id});

    await expect(second).rejects.toThrow();
  });
});

describe('agent_conversations', () => {
  it.each([
    {originKind: 'web' as const, ownerUserId: null},
    {originKind: 'integration' as const, ownerUserId: crypto.randomUUID()},
    {originKind: 'other' as 'web', ownerUserId: null},
  ])('rejects origin $originKind with owner $ownerUserId', async ({originKind, ownerUserId}) => {
    const insert = db().insert(conversations).values({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      agentKey: 'shippy',
      originKind,
      ownerUserId,
    });

    await expect(insert).rejects.toThrow();
  });
});
