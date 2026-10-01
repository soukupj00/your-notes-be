import { randomUUID } from 'node:crypto';
import type { Clock } from '../../shared/clock.ts';
import { newSecret } from '../../shared/crypto.ts';
import { NotFound } from '../../shared/errors.ts';
import type { BlobRecord, ShareRecord, StoredNote } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';
import type { BlobService } from '../blobs/service.ts';

/** A revoked, unknown or trashed share, and a blob it does not list, all read the same. */
const NOT_SHARED = 'Nothing is shared here';

/** Share Links (ADR 0005): one per Note, read by anyone holding the token. */
export class ShareService {
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #blobs: BlobService;

  constructor(store: Store, clock: Clock, blobs: BlobService) {
    this.#store = store;
    this.#clock = clock;
    this.#blobs = blobs;
  }

  /** Sharing a Note again returns its existing Share Link. */
  create(accountId: string, noteId: string): Promise<{ share: ShareRecord; created: boolean }> {
    return this.#store.transaction(async (tx) => {
      // Like a push, so two mints cannot both add a share, nor one share a Note a push purges.
      await tx.accounts.lock(accountId, 'write');
      if (!(await tx.sync.note(accountId, noteId))) throw new NotFound('No such Note');
      const existing = await tx.shares.findForNote(accountId, noteId);
      if (existing) return { share: existing, created: false };
      const share = {
        id: randomUUID(),
        accountId,
        noteId,
        token: newSecret(),
        createdAt: this.#clock().toISOString(),
      };
      await tx.shares.add(share);
      return { share, created: true };
    });
  }

  list(accountId: string): Promise<ShareRecord[]> {
    return this.#store.shares.list(accountId);
  }

  async get(accountId: string, id: string): Promise<ShareRecord> {
    const share = await this.#store.shares.findOwned(accountId, id);
    if (!share) throw new NotFound('No such Share Link');
    return share;
  }

  async revoke(accountId: string, id: string): Promise<void> {
    if (!(await this.#store.shares.removeOwned(accountId, id))) {
      throw new NotFound('No such Share Link');
    }
  }

  async sharedNote(token: string): Promise<StoredNote> {
    const shared = await this.#findShared(token);
    if (!shared) throw new NotFound(NOT_SHARED);
    return shared.note;
  }

  /** Only the bytes of the shared Note's own Attachments and their thumbnails. */
  async sharedBlob(token: string, id: string): Promise<BlobRecord> {
    const shared = await this.#findShared(token);
    const listed = shared?.note.attachments?.some((a) => a.id === id || a.thumbnailId === id);
    const blob = shared && listed ? await this.#blobs.find(shared.accountId, id) : undefined;
    if (!blob) throw new NotFound(NOT_SHARED);
    return blob;
  }

  async #findShared(token: string) {
    const shared = await this.#store.shares.sharedNote(token);
    return shared && shared.note.state !== 'trashed' ? shared : undefined;
  }
}
