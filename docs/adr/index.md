# Decisions

Each record states one decision made in this repository, why it was made, and what was rejected.
A later change amends the record in place and says when.
The app's own decisions are on [the app's site](https://soukupj00.github.io/your-notes-fe/adr/); this server takes its ADRs 0017, 0018 and 0020 as given.

1. [The Owner is created by a Pairing Link printed at first start](0001-the-owner-is-created-by-a-printed-pairing-link.md), and the same one-time codes pair Devices and carry Invites.
2. [The change feed is read from the rows themselves](0002-the-change-feed-is-read-from-the-rows-not-from-a-log.md), not from a change log.
3. [Attachment metadata is a JSON column on the Note](0003-attachment-metadata-is-a-column-on-the-note.md); only blob ownership gets a table.
4. [The backend image takes the built PWA from the published frontend image](0004-the-backend-image-takes-the-pwa-from-the-frontend-image.md), and Caddy is the only proxy.
5. [Share Link tokens are stored in clear](0005-share-link-tokens-are-stored-in-clear.md), unlike every other secret the server keeps.
6. [Records and bytes sit behind two async interfaces](0006-records-and-bytes-sit-behind-two-async-interfaces.md), so a deployment picks its database and its blob storage.
7. [A feature is a module of routes, a service and presenters](0007-a-feature-is-a-module-of-routes-a-service-and-presenters.md), and routes never touch a Store.
