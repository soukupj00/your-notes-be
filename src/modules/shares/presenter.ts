import type { Share, SharedNote, SharesResponse } from '../../contract/index.ts';
import { hal, link } from '../../http/hal.ts';
import type { ShareRecord, StoredNote } from '../../store/records.ts';

export function shareBody(share: ShareRecord): Share {
  return hal(
    { id: share.id, noteId: share.noteId, token: share.token, createdAt: share.createdAt },
    { self: link(`/api/shares/${share.id}`), public: link(`/api/public/shares/${share.token}`) }
  );
}

export function sharesBody(shares: ShareRecord[]): SharesResponse {
  return hal({}, { self: link('/api/shares') }, { shares: shares.map(shareBody) });
}

export function sharedNoteBody(token: string, note: StoredNote): SharedNote {
  const { rev: _rev, ...shown } = note;
  return hal(
    { note: shown },
    {
      self: link(`/api/public/shares/${token}`),
      blobs: link(`/api/public/shares/${token}/blobs/{id}`, { templated: true }),
    }
  );
}
