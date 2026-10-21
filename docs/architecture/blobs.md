# Blobs

The life of an Attachment's bytes, from upload to sweep.
The code is `src/modules/blobs/` (routes and service), `src/http/sendBlob.ts`, `src/infra/blobs/` (disk, S3, memory) and the sweep in `src/modules/housekeeping/`.
The decisions are ADR 0003 (metadata rides on the Note, only ownership gets a table) and frontend ADR 0017 (bytes are write-once by id).

## Two places, one id

The `blobs` table records which Account owns an id, its size and MIME type, and that the bytes exist; the Blob Store holds the bytes under that id.
Attachment metadata (name, kind, dimensions, `thumbnailId`) is a JSON column on the Note and travels with the Note's Revision; the server never reads it except to find what a Note references.
Ids are client UUIDs, so a Device can upload before or after it pushes the Note.

## Upload

`PUT /api/blobs/:id` streams the body straight into the Blob Store; the route needs `Content-Length` and a `Content-Type`, and refuses a body over `BLOB_LIMIT_BYTES` before reading it.
An early answer never reads the body: a refused large one closes the connection, a small one is drained so the connection can be reused.

- Another Account's id: `404`, as unknown as on download.
- A record whose bytes are present: `204` without reading the body; the upload is idempotent, so a retry after a dropped connection costs nothing.
- A record whose bytes are missing: the upload is taken again, which is how a lost file heals.
- Otherwise: bytes first, then the record, `201`.

The Blob Store stores exactly `size` bytes or nothing: on disk the bytes land in `.tmp` and are renamed into place once the size checks out, so a reader never sees a partial file; on S3 the upload is aborted on a short or long body.
Bytes before record means a crash between the two leaves a file without a record, which the sweep removes; the other order would leave a record that vouches for bytes that are not there.

## Download

`GET` and `HEAD /api/blobs/:id` answer only for the Account that owns the id; another Account's id is as unknown as one that does not exist (`404`).
Bytes are immutable by id, so the id is the `ETag`, the response is cacheable for a year, and `If-None-Match` answers `304`.
Every blob response carries `Content-Security-Policy: default-src 'none'; sandbox`, so uploaded bytes never run as a page of this origin, whatever their type.
A record whose bytes are gone answers `404` to `HEAD` and `GET`, even with a matching `If-None-Match`, without caching headers, and logs an error.
The Device then uploads again, and the next `PUT` takes the bytes, as under "Upload".

A Share Link reads the shared Note's own Attachments and their thumbnails through `/api/public/shares/:token/blobs/:id`, nothing else.

## Sweep

The daily sweep (`HousekeepingService`) releases bytes in two steps:

1. Every blob recorded more than a day ago that no Note of its Account lists, as an Attachment or a thumbnail, loses its record and then its bytes.
   The day of grace covers an upload that lands before its Note.
   A purged Note's bytes leave this way too, once its Tombstone has replaced the row.
   A crash between the two deletes leaves a file without a record, which step 2 removes; the other order would leave a record that vouches for bytes that are not there.
2. A file in the Blob Store without a record is deleted when the previous sweep already saw it without one: what a crash left behind, or what step 1 left when it failed between the two deletes.
   A file seen without a record for the first time is only remembered, since an upload may have written its bytes and not yet its record.
   The memory lives in the process, so a server restarted daily would never see a file twice.
   The sweep at startup therefore deletes such a file on first sight: it runs before the server listens and under the instance lock, so no upload can be in flight.

The files are listed before the records are read, so an upload finishing meanwhile is seen together with its record.
On S3 the Blob Store lists only under `S3_PREFIX` (default `yournotes/`), so the sweep never touches the rest of a shared bucket.
A Server Backup lists bytes from the records; a record whose bytes are gone is copied without them, with a warning.
