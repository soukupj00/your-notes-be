// The server's own errors, free of HTTP; `src/problem.ts` gives each its status (ADR 0007).
export class BadRequest extends Error {}
export class Unauthorized extends Error {}
export class Forbidden extends Error {}
export class NotFound extends Error {}
export class Conflict extends Error {}
export class Gone extends Error {}
