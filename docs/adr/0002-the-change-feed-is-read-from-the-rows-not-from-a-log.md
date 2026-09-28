# The change feed is read from the rows themselves, not from a change log

The feed a Device pulls answers one question, "what changed in this Account since Sequence N", and a reader might expect an append-only `changes` table to answer it.
Decided 2026-09-28: every synced row (`notes`, `tags`, `note_tags`, `tombstones`) carries the Sequence at which it was last accepted, indexed with the Account, and the Sequence counter is a column on `accounts` advanced inside the push transaction; a feed page is those rows with a Sequence above the cursor, in order, limited.
A separate log was rejected because it is a second copy of the same fact that a crash between two writes can leave disagreeing with the rows, and because the product keeps no history: ten accepted changes to one Note owe the feed one row, which is exactly what a column gives and a log has to compact towards.
Consequence: a page is assembled from four tables in one read transaction, which is fine at household scale and is the ceiling to revisit if it ever is not.
