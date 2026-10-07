// `src/http/errors.ts` gives each its status; a class extending none of them leaves as a 500.
export class BadRequest extends Error {}
export class Unauthorized extends Error {}
export class Forbidden extends Error {}
export class NotFound extends Error {}
export class Conflict extends Error {}
export class Gone extends Error {}

export class UsernameTaken extends Conflict {
  constructor() {
    super('That username is taken');
  }
}
