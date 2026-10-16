# 2026-10-15 — submission review and hardening

**Artifact type:** chronological session summary written during the same session. It is
not a verbatim transcript; the original Codex chat is the source and should be exported if
available. Times are omitted because a reliable per-message timestamp export was not
available. Sequence is preserved.

**Tool:** OpenAI Codex. The exact backend model identifier was not exposed in the session
export.

## 1. Human instruction
made architectural decisions, plan, technology rationale, and evidence that a human directed

The assistant set one boundary immediately: do not fabricate a "human-only" record. The
brief explicitly asks candidates to use AI, so the credible framing is human-led and
AI-assisted.

## 2. Repository audit

The assistant inspected the tree, Git status/history, README, decision log, service,
adapters, persistence, scoring, and tests. Three parallel reviews covered repository
quality, submission research, and domain/cache design.

Initial findings:

- The implementation was already substantial and well separated into domain,
  application, infrastructure, and GraphQL presentation layers.
- `ai-sessions/` contained only a future-tense placeholder. No original implementation
  transcript was present.
- There was no Git remote and therefore no public repository yet.
- A transient Marine API failure replaced valid cached wave data with `null`.
- Stale weather could be served indefinitely and eventually return fewer than seven days.
- Node 20 and Apollo Server 4 were end-of-life on the review date.

The first check run was misleading because dependencies were absent/incomplete and global
tool versions were picked up. A clean locked install was performed before treating failures
as source defects. Baseline after `npm ci`: 47 unit tests passed, build/lint/format passed,
and five GraphQL e2e tests passed (the e2e run needed loopback permission in the sandbox).

## 3. External research used

The evidence format was informed by current public examples:

- [JTL take-home rubric](https://github.com/jtl-software/take-home-tasks/blob/main/README.md): plan, key prompts, tools/models, and AI mistakes/overrides are useful evidence.
- [Trilogy assignment](https://github.com/trilogy-group/ti-assignment-say-it-in-json/blob/master/assignment.md): chronological sessions, including errors and retries, can be a primary deliverable.
- [SweetTech senior assignment](https://github.com/SweetTech-AI/agentic-assignment): explain what was delegated, rewritten, or rejected.

Official technical sources drove the dependency decision:

- [Node release status](https://nodejs.org/en/about/previous-releases): Node 20 is EOL;
  Node 24 is LTS.
- [Apollo version policy](https://www.apollographql.com/docs/apollo-server/previous-versions): Apollo Server 4 reached EOL on 2026-01-26; Apollo 5 is supported.
- [Nest GraphQL setup](https://docs.nestjs.com/graphql/quick-start): supported Apollo integration and local IDE behavior.
- [Nest 12 migration guide](https://docs.nestjs.com/migration-guide): CommonJS applications
  can remain CommonJS on a recent Node runtime; a full application ESM rewrite is optional.

## 4. Decisions, including a rejected path

### Accepted: strict seven-date coverage

Fresh or fallback weather must contain today + 6 in the resolved timezone. Returning six
days during a long outage is not the contract in the brief. The tradeoff is lower
availability after local midnight if the provider is down.

### Accepted: retain last-known marine data

Marine failure is a partial failure. A refresh keeps prior useful wave data instead of
erasing it. The combined snapshot still cannot express provider-specific freshness; that
limitation is recorded rather than hidden.

### Rejected: Nest 12 / TypeScript 6 migration in this exercise

The first supported-stack attempt upgraded to Nest 12. It exposed ESM/CommonJS interop
failures in the project's existing Jest/runtime configuration, and TypeScript 6 exposed
additional module-layout work. Nest's migration guidance does not require every CommonJS
application to convert to ESM; the decision here was narrower: time-box that integration
work rather than expand a weather-service exercise into a build-system migration.

The chosen path is Node 24 + Nest 11 + `@nestjs/graphql` 13 + Apollo Server 5. It keeps the
existing module model while removing the EOL runtime/server. A narrow override moves
`@graphql-tools/utils` to the patched 12.1.0 release. `npm audit --omit=dev` reports zero
production vulnerabilities. Nest's Apollo package still installs an unused legacy
Playground plugin and npm prints a peer warning; the application does not enable that
plugin. Moving fully to Nest 12 ESM is deferred.

### Accepted: repository evidence, not a slide deck

The exercise explicitly prioritizes how the candidate worked. The primary evidence is this
log, the dated decision log, focused diffs/commits, tests, and candid gaps. A polished deck
would add presentation without stronger provenance.

## 5. Changes made in this session

- Enforced complete next-seven-local-date coverage before caching or stale fallback.
- Preserved last-known marine data across transient refresh failures.
- Made the seven-date window request-scoped and kept refreshes serialized by location. A
  tagged shared attempt lets a post-midnight caller revalidate and retry without parallel
  cache writes; an independent review found both the read and write-order races.
- Made malformed cached payloads trigger refresh instead of leaking parser errors.
- Made malformed marine payloads fail soft without displacing last-known-good surf data.
- Replaced DST-sensitive fixture date arithmetic with local calendar-date stepping.
- Added focused regressions for cache coverage, marine retention, malformed cache data,
  and both midnight races.
- Upgraded Node/Docker to 24, Nest to 11, and Apollo Server to 5.
- Disabled GraphiQL and introspection in production.
- Added a production dependency audit and CI quality gate.
- Disabled incremental compilation in the production build config after a retained build
  cache let `nest build` delete `dist` and then incorrectly emit nothing.
- Replaced the empty AI-session promise with this provenance-aware index and log.
- Updated README stack rationale and cache semantics; added D11–D14 to `NOTES.md`.
- Corrected freshness descriptions: the compact API reports atmospheric freshness;
  retained marine data can be older.

An in-place Jest 30 dev-tool upgrade initially produced orphaned optional resolver entries.
That result was rejected rather than committed. Regenerating the lock from `package.json`
in an isolated temporary directory produced a clean tree, so Jest 30 was adopted and then
verified with `npm ci` and `npm ls`. The full audit now reports 20 moderate advisories in
the dev-only Jest/ts-jest coverage chain (down from 5 moderate and 29 high on Jest 29);
`npm audit --omit=dev` is the release gate and reports zero production vulnerabilities.

## 6. Verification record

Final results after the last code/configuration diff:

- `npm ci`: passed; 828 packages installed from the lockfile. npm reported 20 moderate
  dev-only advisories and emitted the known peer warning for Nest's unused legacy
  Playground dependency, both recorded above.
- `npm test -- --runInBand`: passed — 8 suites, 56 tests.
- `npm run test:e2e -- --runInBand`: passed — 1 suite, 5 tests; real Nest, GraphQL,
  and in-memory TypeORM, with network adapters faked.
- `npm run build` twice consecutively: passed; `dist/main.js` and `dist/app.module.js`
  existed after the second run.
- Non-test application initialization: passed and regenerated committed `schema.gql`.
- `npm run lint:check`: passed with no findings.
- `npm run format:check`: passed.
- `npm run audit:prod -- --json`: passed — 0 production vulnerabilities.
- `npm ls --depth=0`: passed — no invalid or missing direct dependency.
- `docker compose config`: passed.
- `docker compose build`: not run; Docker CLI was present but the local Docker daemon was
  not running. CI still exercises the same `npm ci` and build path; a candidate with Docker
  running should execute this before sign-off.

## 7. Human sign-off — intentionally not completed by AI

- [ ] I reviewed every file in the final diff.
- [ ] I personally ran the verification commands above.
- [ ] I can explain and defend D1–D14 without reading a script.
- [ ] I agree with the scoring assumptions and known limitations.
- [ ] I recorded my actual total time spent: `________`.
- [ ] Name/date: `________________________________`.

## 8. Product recommendation follow-up — 2026-10-16 IST

### Human feedback

After calling `activityForecast` from Postman, the candidate challenged the output: 28
ranked scores are evidence, but they do not directly tell an end user what to plan. They
asked for a lean city/country request, natural country names such as `INDIA`, `USA`, or
`UNITED STATES OF AMERICA`, and a clear date-level skiing/surfing/sightseeing decision.
Location coordinates, cache freshness, and the full forecast should be available only to
clients that explicitly ask for detail.

### Decisions and implementation

- Added `activityRecommendations(city, country?)` as the product operation while retaining
  `activityForecast` as the expert/debug evidence operation. GraphQL selection sets keep
  both responses explicit; there is no mode flag that changes one field's meaning.
- Added a pure recommendation policy over the existing ranked scores: `PLAN` at 70+,
  `CONSIDER` at 40–69, `SKIP` below 40, and `UNAVAILABLE` for `null`. A SKIP/UNAVAILABLE
  result never receives a `recommendedDate`.
- Added concise human-readable decisions and an advisory. The wording says “plan,” not
  “safe to book”: weather alone cannot verify tides, avalanche conditions, ability,
  venue/resort operations, access, or inventory.
- Kept the overall summary from naming a single winner. Scores are useful within an
  activity, but have not been calibrated for cross-activity comparison.
- Added application-boundary normalization from case-insensitive English country names or
  ISO alpha-2/alpha-3 to the alpha-2 value Open-Meteo expects. Equivalent inputs share one
  canonical geocode cache key. Unknown values return `INVALID_COUNTRY` before network I/O.
- Added unit tests at both threshold boundaries, missing-data behavior, country aliases,
  invalid country handling, and a full GraphQL recommendation test.
- Updated the generated schema, README, examples, error fixture, and decision log.

### Correction made during verification

Installing the country package into the existing dependency tree produced a lockfile that
failed `npm ci` because a platform-optional WASI dependency was recorded without its full
graph. This was not ignored or hand-edited. The lockfile was regenerated from
`package.json` in an empty temporary directory, copied back as a generated artifact, and
then verified with a successful clean install. `npm ls --depth=0` subsequently showed no
missing, invalid, or extraneous direct packages.

### Verification after the final clean install

- `npm ci`: passed — 830 packages installed from the repaired lockfile. The known Nest
  transitive legacy Playground peer warning remains; the application does not enable it.
- `npm test -- --runInBand`: passed — 10 suites, 78 tests.
- `npm run test:e2e -- --runInBand`: passed — 1 suite, 6 tests; external HTTP remained
  disabled/faked.
- `npm run build`: passed.
- Non-test application initialization: passed and regenerated `schema.gql`.
- `npm run lint:check`: passed.
- `npm run format:check`: passed.
- `npm run audit:prod -- --json`: passed — 0 production vulnerabilities.
- `npm ls --depth=0`: passed with a clean direct dependency tree.
