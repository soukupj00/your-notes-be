import { describe, expect, it } from 'vitest';
import { decide } from './decide.ts';

const at = (rev: number) => ({ rev });

describe('decide: a Note or Tag', () => {
  for (const kind of ['note', 'tag'] as const) {
    it(`${kind}: no rev and nothing on the server is accepted at rev 1`, () => {
      expect(decide({ kind }, undefined, false)).toEqual({
        status: 'accepted',
        rev: 1,
        write: 'row',
      });
    });

    it(`${kind}: no rev for an id the server has is a conflict`, () => {
      expect(decide({ kind }, at(3), false)).toEqual({ status: 'conflict' });
    });

    it(`${kind}: an equal rev is accepted at rev + 1`, () => {
      expect(decide({ kind, rev: 3 }, at(3), false)).toEqual({
        status: 'accepted',
        rev: 4,
        write: 'row',
      });
    });

    it(`${kind}: a lower or a higher rev is a conflict`, () => {
      expect(decide({ kind, rev: 2 }, at(3), false)).toEqual({ status: 'conflict' });
      expect(decide({ kind, rev: 4 }, at(3), false)).toEqual({ status: 'conflict' });
    });

    it(`${kind}: anything for a tombstoned id is gone`, () => {
      expect(decide({ kind }, undefined, true)).toEqual({ status: 'gone' });
      expect(decide({ kind, rev: 5 }, undefined, true)).toEqual({ status: 'gone' });
    });

    it(`${kind}: a rev the server has forgotten is accepted again at rev 1`, () => {
      expect(decide({ kind, rev: 7 }, undefined, false)).toEqual({
        status: 'accepted',
        rev: 1,
        write: 'row',
      });
    });
  }
});

describe('decide: a NoteTag', () => {
  it('is accepted new at rev 1, and over an existing link at rev + 1, whatever rev it carries', () => {
    expect(decide({ kind: 'noteTag' }, undefined, false)).toEqual({
      status: 'accepted',
      rev: 1,
      write: 'row',
    });
    expect(decide({ kind: 'noteTag', rev: 1 }, at(4), false)).toEqual({
      status: 'accepted',
      rev: 5,
      write: 'row',
    });
  });

  it('is gone when its Note or Tag is tombstoned or missing', () => {
    expect(decide({ kind: 'noteTag', rev: 1 }, at(1), true)).toEqual({ status: 'gone' });
  });
});

describe('decide: a Tombstone', () => {
  for (const of of ['note', 'tag'] as const) {
    it(`${of}: at the server's rev, the row goes and the Tombstone is written`, () => {
      expect(decide({ kind: 'tombstone', of, rev: 2 }, at(2), false)).toEqual({
        status: 'accepted',
        rev: 3,
        write: 'tombstone',
      });
    });

    it(`${of}: a lower, higher or absent rev is a conflict, so a newer edit survives`, () => {
      for (const rev of [1, 3, undefined]) {
        expect(decide({ kind: 'tombstone', of, rev }, at(2), false)).toEqual({
          status: 'conflict',
        });
      }
    });

    it(`${of}: for something the server never had, still written so every Device hears of it`, () => {
      expect(decide({ kind: 'tombstone', of, rev: 4 }, undefined, false)).toEqual({
        status: 'accepted',
        rev: 1,
        write: 'tombstone',
      });
    });

    it(`${of}: for something already tombstoned, accepted with nothing written`, () => {
      expect(decide({ kind: 'tombstone', of }, undefined, true)).toEqual({
        status: 'accepted',
        rev: 1,
        write: 'nothing',
      });
    });
  }

  it('noteTag: accepted over the link whatever rev it carries', () => {
    for (const rev of [1, 9, undefined]) {
      expect(decide({ kind: 'tombstone', of: 'noteTag', rev }, at(4), false)).toEqual({
        status: 'accepted',
        rev: 5,
        write: 'tombstone',
      });
    }
  });
});
