# Attachment metadata is a JSON column on the Note; only blob ownership gets a table

ADR 0017 (frontend) puts an Attachment's metadata inside the Note's Revision: it arrives with the Note, leaves with it, and has no life of its own on the server.
Decided 2026-09-28: the server stores that metadata as one JSON column on `notes` and never unpacks it, and a small `blobs` table (id, Account, size, MIME type, created) answers the only questions the server asks about bytes, whether an id exists and whose it is, without touching the disk.
An `attachments` table was rejected as a join the server would maintain on every accepted Note and read on none; the frontend keeps its own table because it does query it.
