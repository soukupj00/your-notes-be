import type { ChangesPage, PushOutcome, PushResponse } from '../../contract/index.ts';
import { hal, link } from '../../http/hal.ts';
import type { FeedPage } from './service.ts';

export function pushBody(outcomes: PushOutcome[], seq: number): PushResponse {
  return hal({ outcomes, seq }, { self: link('/api/changes'), changes: link('/api/changes') });
}

export function pageBody(
  { next: cursor, ...page }: FeedPage,
  since: number,
  from: number | undefined
): ChangesPage {
  const next = cursor ? link(`/api/changes?since=${cursor.since}&from=${cursor.from}`) : null;
  return hal(page, {
    self: link(`/api/changes?since=${since}${from === undefined ? '' : `&from=${from}`}`),
    ...(next ? { next } : {}),
    // A short page delivered everything up to the Account's Sequence, so that is the cursor.
    resume: next ?? link(`/api/changes?since=${page.seq}`),
    stream: link('/api/changes/stream'),
  });
}
