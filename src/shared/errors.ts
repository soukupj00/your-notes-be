// The server's own errors, free of HTTP; `src/http/errors.ts` gives each its status (ADR 0007).
export class BadRequest extends Error {}
export class Unauthorized extends Error {}
export class Forbidden extends Error {}
export class NotFound extends Error {}
export class Conflict extends Error {}
export class Gone extends Error {}

/** Thrown by a Store, whose database keeps usernames unique. */
export class UsernameTaken extends Conflict {
  constructor() {
    super('That username is taken');
  }
}
