/**
 * The sync rules (PLAN.md "Sync rules"): what the server does with one pushed row.
 * Pure: no HTTP, no Drizzle; the push route gathers the server's state and applies the decision.
 */

export type Incoming =
  | { kind: 'note' | 'tag' | 'noteTag'; rev?: number | undefined }
  | { kind: 'tombstone'; of: 'note' | 'tag' | 'noteTag'; rev?: number | undefined };

export type Decision =
  /** `write`: store the row, store a Tombstone (and delete the row), or nothing (already gone). */
  | { status: 'accepted'; rev: number; write: 'row' | 'tombstone' | 'nothing' }
  | { status: 'conflict' }
  | { status: 'gone' };

/**
 * @param existing the server's row for this id, if any
 * @param tombstoned for a Note, Tag or Tombstone: the server has a Tombstone for this id;
 *   for a NoteTag: its Note or Tag is tombstoned or missing
 */
export function decide(
  incoming: Incoming,
  existing: { rev: number } | undefined,
  tombstoned: boolean
): Decision {
  const next = (existing?.rev ?? 0) + 1;
  if (incoming.kind === 'tombstone') {
    // Idempotent: another Device may have sent the same Tombstone first.
    if (tombstoned) return { status: 'accepted', rev: next, write: 'nothing' };
    // Purging a Note or Tag the Device has not seen at its latest would discard a newer edit.
    if (incoming.of !== 'noteTag' && existing && incoming.rev !== existing.rev) {
      return { status: 'conflict' };
    }
    return { status: 'accepted', rev: next, write: 'tombstone' };
  }
  if (tombstoned) return { status: 'gone' };
  // A link has nothing to conflict over.
  if (incoming.kind === 'noteTag') return { status: 'accepted', rev: next, write: 'row' };
  // New to the server. A `rev` here means the server forgot the row (its Tombstone expired);
  // accepting it again loses nothing the person wrote.
  if (!existing) return { status: 'accepted', rev: 1, write: 'row' };
  // Equal rev: the Device edited what the server has. No rev, a lower one, or an impossible
  // higher one: the Device is out of date and makes a Conflicted Copy.
  if (incoming.rev === existing.rev) return { status: 'accepted', rev: next, write: 'row' };
  return { status: 'conflict' };
}
