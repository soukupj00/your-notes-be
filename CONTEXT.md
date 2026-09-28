# Self-hosted Server

The language of the sync server.
Product terms (Note, Tag, Local Account, Owner, Invite, Device, Revision, Tombstone, Pairing Link) are canonical in the frontend glossary, `../ni-dip-fe/CONTEXT.md`; this file records only the terms the server needs and the app does not.

## Language

**Session**:
The server's record that one Device is signed in to one Local Account.
Revoking a Device is ending its Session; nothing else about the Account changes.
_Avoid_: token, login, JWT

**Pairing Code**:
The one-time, expiring secret behind a Pairing Link, kept by the server until it is spent.
One Pairing Code has one purpose: create the Owner, add a Device to an Account, or carry an Invite.
_Avoid_: setup token, invite code, magic link

**Sequence**:
The Account's count of accepted changes, one number per Account, advanced by every accepted push.
A Sequence orders the change feed and is what a Device's cursor and a Live Update hint carry; it is distinct from a Revision, which counts the changes of one thing.
_Avoid_: version, cursor (a cursor is a position in the feed, expressed as a Sequence)
