# The Owner is created by a Pairing Link printed at first start, and the same one-time codes pair Devices and carry Invites

ADR 0018 in the frontend repository said the first visit to a fresh server creates the Owner.
On a LAN that is a race anyone who reaches the address first can win, and it leaves the phone typing a password to join.
Decided 2026-09-28: at first start the server prints a Pairing Link (plain URL and ASCII QR) to its log; opening it creates the Owner and signs that Device in, and no other route can create the Owner.
The same mechanism, a table of hashed one-time codes with a kind (`setup`, `device`, `invite`), a ten-minute expiry and single use, serves the other two joining moments: a signed-in Device shows a Link that adds another Device to its Account, and the Owner shows one that carries an Invite.
The PWA renders the QR from the URL; the server only mints codes and accepts them in place of a password.
Considered and rejected: JSON Web Tokens, because a stateless token cannot end one Device's access without a denylist, which is the session table this design already has; and keeping the open first visit, because the race is real and the token costs one printed line.
The Link removes typing, not TLS: the scanning phone must reach the origin and trust its certificate.
