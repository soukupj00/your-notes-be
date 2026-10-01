# A feature is a module of routes, a service and presenters, and routes never touch a Store

Until now a route file parsed the request, queried Drizzle, applied the rules and built the HAL body, and route files imported helpers from each other (`setup.ts` from `accounts.ts` and `session.ts`, `shares.ts` from `blobs.ts`).
Decided 2026-09-30: `src/modules/<feature>/` holds a feature's `routes.ts` (HTTP only: schemas, auth, status codes), `service.ts` (the rules) and `presenter.ts` (records to HAL bodies).
A service is a class that takes its Store, BlobStore, clock and config in the constructor, so a reader finds a rule in one place and a test can build one with anything it likes.
`src/http/` holds what every route shares (auth, security headers, error mapping, HAL, ETag), `src/infra/` the Store and BlobStore implementations (ADR 0006), and `src/shared/` the small helpers with no other home (secrets and hashing, the clock, the errors).

`server.ts` is the one place that builds the Stores and services and hands them to routes through Fastify's `app.decorate`; that is all the dependency injection this server needs.
Services throw the server's own errors (`NotFound`, `Conflict`, `Forbidden`, ...), and the one error handler turns each into problem details, so a handler never builds an error response itself.
Behaviour that cuts across an interface, such as the SQLite lock, is a wrapper implementing the same interface.
`modules/sync/decide.ts` stays pure, and `src/contract/index.ts` keeps its path because the frontend's `contract:pull` reads it there.
`main.ts`, `cli.ts`, `server.ts` and `config.ts` stay at the root of `src/`, so `node dist/cli.js` and the image's command do not change.

Considered and rejected:

- TypeScript decorators for routes and injection (the NestJS style): they need the legacy `experimentalDecorators` and `reflect-metadata`, and they replace the Zod schemas that type every handler today; adopting them is adopting NestJS.
- A dependency-injection container: one composition function wires every object the server has.
- Abstract base classes for services or routes: they would share no behaviour.
