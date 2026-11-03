import {itemId, userItem} from '#test/fixtures/conversation-items.js';
import {lastItemSeq, mergeItemPages, withLiveItems} from './conversation.js';

describe('mergeItemPages', () => {
  test('orders items from newest-first pages and reads the queue from the newest page', () => {
    const merged = mergeItemPages([
      {
        items: [userItem(3, 'c'), userItem(4, 'd')],
        queued: [userItem(null, 'q', 'q')],
        hasMore: true,
      },
      {
        items: [userItem(1, 'a'), userItem(2, 'b')],
        queued: [userItem(null, 'old', 'old')],
        hasMore: false,
      },
    ]);

    expect(merged.items.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
    expect(merged.queued.map((item) => item.id)).toEqual(['q']);
  });
});

describe('withLiveItems', () => {
  test('drops an input from the queue once the stream claims it', () => {
    const queued = userItem(null, 'Next', itemId(5));
    const merged = withLiveItems(
      {items: [userItem(4, 'Before')], queued: [queued]},
      {items: [{...queued, seq: 5}], queued: []},
    );

    expect(merged.items.map((item) => item.seq)).toEqual([4, 5]);
    expect(merged.queued).toEqual([]);
    expect(lastItemSeq(merged.items)).toBe(5);
  });
});
