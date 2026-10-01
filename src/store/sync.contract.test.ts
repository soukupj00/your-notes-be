import { beforeEach, describe, expect, it } from 'vitest';
import { attachment, eachStore, link, note, T, tag } from '../test/storeContract.ts';
import type { Store } from './Store.ts';

// The sync group of the Store contract (store.contract.test.ts); every Store runs it.
eachStore((current) => {
  let store: Store;
  beforeEach(() => {
    store = current();
  });

  describe('sync', () => {
    it("keeps the Account's Sequence, 0 for an unknown Account", async () => {
      expect(await store.sync.sequence('a')).toEqual({ seq: 0, prunedSeq: 0 });
      await store.sync.setSequence('a', 7);
      expect(await store.sync.sequence('a')).toEqual({ seq: 7, prunedSeq: 0 });
      expect(await store.sync.sequence('x')).toEqual({ seq: 0, prunedSeq: 0 });
    });

    it('stores rows as given, absent fields absent, and replaces them per Account', async () => {
      const full = note('n', { header: 'Hi', pinnedAt: T, attachments: [attachment('f')] });
      await store.sync.putNote('a', note('n'), 1);
      expect(await store.sync.note('a', 'n')).toEqual(note('n'));
      await store.sync.putNote('a', { ...full, rev: 2 }, 2);
      expect(await store.sync.note('a', 'n')).toEqual({ ...full, rev: 2 });
      expect(await store.sync.note('b', 'n')).toBeUndefined();
      await store.sync.putTag('a', tag('t'), 3);
      expect(await store.sync.tag('a', 't')).toEqual(tag('t'));
      await store.sync.putNoteTag('a', link('n', 't'), 4);
      expect(await store.sync.noteTag('a', 'n', 't')).toEqual(link('n', 't'));
      expect(await store.sync.noteTag('b', 'n', 't')).toBeUndefined();
    });

    it('removes a Note or a Tag with its links, and a single link', async () => {
      await store.sync.putNote('a', note('n'), 1);
      await store.sync.putNote('a', note('m'), 2);
      await store.sync.putTag('a', tag('t'), 3);
      await store.sync.putTag('a', tag('u'), 4);
      for (const [n, t, seq] of [
        ['n', 't', 5],
        ['m', 't', 6],
        ['m', 'u', 7],
      ] as const) {
        await store.sync.putNoteTag('a', link(n, t), seq);
      }
      await store.sync.removeNote('a', 'n');
      expect(await store.sync.note('a', 'n')).toBeUndefined();
      expect(await store.sync.noteTag('a', 'n', 't')).toBeUndefined();
      expect(await store.sync.noteTag('a', 'm', 't')).toBeDefined();
      await store.sync.removeTag('a', 't');
      expect(await store.sync.noteTag('a', 'm', 't')).toBeUndefined();
      expect(await store.sync.noteTag('a', 'm', 'u')).toBeDefined();
      await store.sync.removeNoteTag('a', 'm', 'u');
      expect(await store.sync.noteTag('a', 'm', 'u')).toBeUndefined();
    });

    it('records Tombstones per Account and kind', async () => {
      await store.sync.addTombstone('a', { kind: 'note', id: 'n', deletedAt: T }, 1);
      expect(await store.sync.isTombstoned('a', 'note', 'n')).toBe(true);
      expect(await store.sync.isTombstoned('a', 'tag', 'n')).toBe(false);
      expect(await store.sync.isTombstoned('b', 'note', 'n')).toBe(false);
      await store.sync.removeTombstone('a', 'note', 'n');
      expect(await store.sync.isTombstoned('a', 'note', 'n')).toBe(false);
    });

    it('reads changes after a Sequence, up to a limit per kind, in Sequence order', async () => {
      await store.sync.putNote('a', note('n3'), 3);
      await store.sync.putNote('a', note('n1'), 1);
      await store.sync.putNote('a', note('n5'), 5);
      await store.sync.putNote('a', note('n6'), 6);
      await store.sync.putTag('a', tag('t4'), 4);
      await store.sync.putNoteTag('a', link('n5', 't4'), 7);
      await store.sync.addTombstone('a', { kind: 'tag', id: 'gone', deletedAt: T }, 8);
      await store.sync.putNote('b', note('theirs'), 9);
      const changes = await store.sync.changesSince('a', 1, 2);
      expect(changes.notes).toEqual([
        { seq: 3, record: note('n3') },
        { seq: 5, record: note('n5') },
      ]);
      expect(changes.tags).toEqual([{ seq: 4, record: tag('t4') }]);
      expect(changes.noteTags).toEqual([{ seq: 7, record: link('n5', 't4') }]);
      expect(changes.tombstones).toEqual([
        { seq: 8, record: { kind: 'tag', id: 'gone', deletedAt: T } },
      ]);
    });
  });
});
