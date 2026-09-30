import type { Share, SharedNote, SharesResponse } from '../../contract/index.ts';
import { noteFromRow } from '../../db/rows.ts';
import { hal, link } from '../../http/hal.ts';
import type { NoteRow, ShareRow } from './service.ts';

export function shareBody(row: ShareRow): Share {
  return hal(
    { id: row.id, noteId: row.noteId, token: row.token, createdAt: row.createdAt },
    { self: link(`/api/shares/${row.id}`), public: link(`/api/public/shares/${row.token}`) }
  );
}

export function sharesBody(rows: ShareRow[]): SharesResponse {
  return hal({}, { self: link('/api/shares') }, { shares: rows.map(shareBody) });
}

/** The Note without its Revision. */
export function sharedNoteBody(token: string, note: NoteRow): SharedNote {
  const { rev: _rev, ...shown } = noteFromRow(note);
  return hal(
    { note: shown },
    {
      self: link(`/api/public/shares/${token}`),
      blobs: link(`/api/public/shares/${token}/blobs/{id}`, { templated: true }),
    }
  );
}
