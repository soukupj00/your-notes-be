# Share Link tokens are stored in clear, unlike every other secret the server keeps

Sessions and Pairing Codes are kept only as SHA-256 hashes, so a leaked database cannot sign anyone in.
Decided 2026-09-28: a Share Link's token is stored as it is, because the person who shared a Note must be able to copy the same link again later, and a hash cannot be turned back into the link.
Hashing would protect nothing here: a Share Link only reveals one Note read-only, and whoever has the database already has every Note in it.
Considered and rejected: hashing and showing the link only once, which makes "copy the link again" mint a new token and silently break every copy already sent.
A share is revoked by deleting it, and one Note has at most one share, so revoking it is unambiguous.
