# 2026-10-16 — booking-grade recommendation follow-up

**Artifact type:** chronological work summary written during the session. This is not a
verbatim chat export. The actual Codex conversation remains the primary interaction record
and should be exported or linked if the submission platform permits it.

## 1. Human challenge

The candidate manually called the recommendation query for Zermatt. Skiing returned
`UNAVAILABLE` because public terrain lookup failed, even though Zermatt is a known ski
destination. They asked to make the result production/booking-grade and explicitly asked
for an independent QA agent to test multiple realistic scenarios and drive further fixes.

## 2. QA delegation before implementation

A QA agent first ran the baseline suite (78 unit tests and 6 GraphQL e2e tests passed),
then challenged the product semantics rather than only checking HTTP success. Its release
criteria included:

- no ski booking signal without a concrete venue and mountain—not town—weather;
- open, closed and unknown operational states must behave differently;
- “not applicable” must not be confused with “provider unavailable”;
- confidence, evidence provenance and activity-specific freshness must be exposed;
- Zermatt must have a deterministic failure-safe path;
- non-ski, coastal, stale-cache and provider-outage scenarios must be repeatable.

Those findings changed the design and are represented in the final
[QA matrix](../qa/booking-recommendation-matrix.md), not hidden in a polished retrospective.

## 3. Research and the decision it changed

- [Open-Meteo forecast documentation](https://open-meteo.com/en/docs) supports an explicit
  elevation parameter. That made a separately persisted resort-elevation forecast feasible.
- [OpenStreetMap Overpass guidance](https://wiki.openstreetmap.org/wiki/Overpass_API/Wording)
  documents load-shedding/resource-limit failure modes. A public query endpoint should not
  be the only synchronous source for a destination the product claims to support.
- [Zermatt's official lifts and pistes page](https://zermatt.swiss/en/info/lifts-pistes)
  provides the authoritative live check. The implementation links to it; it does not freeze
  a transient open/closed claim in source code.

The accepted design is therefore a small, explicit reviewed catalog for deterministic
known-resort fallbacks plus OSM discovery elsewhere. A production service would replace the
two-entry seed with a reviewed offline import into its own geospatial database.

## 4. Implementation decisions

- Replaced the boolean terrain answer with a `SkiArea`: identity, source, mountain forecast
  point/elevation, operations state and optional official status URL.
- Added deterministic catalog entries for Matterhorn Ski Paradise and Chamonix. Both use
  `UNKNOWN` operations status so the service cannot accidentally claim a resort is open.
- Fetch and persist separate mountain weather when a concrete ski venue is found. Failure
  does not fall back to misleading valley weather.
- Added `bookingReadiness`, `confidence`, `dataAsOf`, `evidence`, and
  `checksBeforeBooking` to the lean GraphQL recommendation.
- A weather `PLAN` with unknown live conditions becomes `VERIFY_LIVE_STATUS`; `CLOSED`
  always becomes `SKIP`; confirmed `OPEN` may be `READY_TO_PLAN`.
- Split `NOT_APPLICABLE` (no venue/coast) from `DATA_UNAVAILABLE` (provider/required-data
  failure). Marine status and timestamps are persisted independently.
- Preserved `activityForecast` as the detailed 4 × 7 diagnostic view.

## 5. Corrections found by verification

- The first e2e run failed with `listen EPERM` because the execution sandbox blocked the
  ephemeral Supertest port. The same suite passed outside that network namespace; this was
  an environment restriction, not recorded as an application pass.
- The first lint gate caught unused placeholder parameters added to richer test-provider
  signatures and temporary catalog destructuring. The parameters were removed and the
  catalog now maps its public shape explicitly.
- README caveats still described skiing at town coordinates after the code had changed.
  They were corrected before handoff instead of leaving conflicting documentation.
- The independent QA rerun initially rejected the release for three semantic bugs: missing
  mountain data could be mislabeled `VERIFY_LIVE_STATUS`, a closed resort did not override
  missing weather, and 70 km/h wind could still score 90/100. The release was held. Closure
  now wins independently, unavailable data stays `DATA_UNAVAILABLE`, and likely lift-closing
  wind is capped below the recommendation thresholds.
- The same QA pass found that global atmospheric staleness could hide stale mountain data or
  downgrade fresh mountain evidence. Marine and mountain fallback state is now tracked and
  disclosed per source. It also caught an OSM provenance URL mislabeled as live lift status;
  source and operations URLs are now separate concepts.

## 6. Verification record

At the time this entry was created:

- `npm test -- --runInBand`: passed — 10 suites, 93 tests.
- `npm run test:e2e -- --runInBand`: passed — 2 suites, 12 tests; real Nest/GraphQL/DB,
  external HTTP faked. The booking matrix includes Zermatt, Phoenix, Biarritz and failure
  isolation.
- `npm run build`: passed.
- Live smoke: Zermatt, Phoenix and Biarritz completed against current providers; see the
  [dated response log](../examples/responses/live-booking-smoke-2026-10-16.md). Public
  Overpass returned capacity/time-out failures for uncatalogued cities, and the API safely
  emitted `DATA_UNAVAILABLE` rather than a false geography claim.

The final lint, format, dependency and independent-QA results are appended after their
release gates complete.

### Independent QA verdict after corrections

The same QA agent reran the corrected tree without editing it and returned **SHIP for the
explicitly scoped take-home / booking-aware recommendation contract**. It explicitly warned
not to call this a globally complete booking engine.

- Unit: 10 suites / 93 tests passed.
- GraphQL e2e: 2 suites / 12 tests passed.
- Build, lint, format, production audit (0 vulnerabilities), direct dependency tree and
  `git diff --check`: passed.
- Adversarial probes passed for closed + missing weather, known venue + missing mountain
  weather, 70 km/h lift-closing wind, and stale mountain evidence.
- Independent live smoke repeated Zermatt, Biarritz and Phoenix. A second Zermatt request
  returned HTTP 200 in 0.009 s with unchanged `dataAsOf`, exercising the persisted cache.
  Public Overpass again produced real capacity/time-out failures for uncatalogued cities;
  failure isolation and `DATA_UNAVAILABLE` semantics held.

The only non-blocking wording note was corrected in the dated smoke log: Open-Meteo reports
modeled snow depth, not an authoritative piste-base measurement.

## 7. Candidate sign-off — intentionally left to the human

- [ ] I reviewed the final GraphQL contract and agree that `PLAN` is a weather signal, not
  a guarantee that a purchase is safe or available.
- [ ] I can explain why Zermatt uses a mountain target and why live operations stay unknown.
- [ ] I reviewed and agree with D17–D18 in `NOTES.md`.
- [ ] I personally ran at least the Zermatt, inland and coastal scenarios.
- [ ] I recorded my actual time spent: `________`.
- [ ] Name/date: `________________________________`.

## 8. Human-requested NFR hardening follow-up

The candidate next selected seven concrete production controls: rate limiting; GraphQL
depth, complexity and alias limits; conditional authentication/authorization; explicit
CORS; TLS termination; body-size limits; and WAF or gateway protection. They also asked for
the score-generation logic to be highlighted. This scope came from the human, not an
autonomous “polish” pass.

Implementation choices made during the session:

- use maintained `helmet` and `express-rate-limit` packages instead of handwritten header
  or timer code;
- keep auth disabled for the local evaluator, but force scoped API-key auth in the secure
  deployment profile and abort startup if private mode has no key;
- validate GraphQL shape before resolver execution with separate depth, alias, root-field
  and weighted-cost budgets; keep HTTP query batching disabled;
- accept only exact configured browser origins and trust no forwarding hop locally;
- terminate TLS at an NGINX gateway which also owns edge route/method/body/rate/connection
  limits and replaces untrusted forwarding headers;
- describe this accurately as gateway protection. A managed WAF is a hosting choice and was
  not falsely presented as provisioned;
- write the exact current score formulas and operational overrides into
  `docs/SCORING.md`, including optimistic missing-field behavior and non-comparability of
  scores across activities.

Corrections found while verifying:

- A new rate-limit test initially lived in the unit suite, where the execution sandbox
  prohibited its ephemeral listener. It was moved to the e2e suite, which already represents
  the HTTP boundary; unit tests remain socket-free.
- The first security e2e compilation rejected an over-broad `unknown` request-body type;
  the helper was narrowed to Supertest's accepted body types.
- A denied CORS preflight correctly omitted the allow-origin header but then reached Apollo,
  which answered 400 rather than 204. The test now asserts that actual denied behavior.
- Apollo standardizes validation errors to `GRAPHQL_VALIDATION_FAILED` while preserving the
  custom `limitType`, `limit`, and `actual` extensions. The boundary test was aligned with
  the real wire contract instead of the rule's pre-Apollo internal code.
- Expected authentication failures were initially logged by Nest as server exceptions. A
  narrow GraphQL error filter now returns them without noisy false-positive server logs.

Verification results for this follow-up are recorded in the final handoff after all build,
test, lint, formatting, dependency and deployment-config checks complete.

### NFR verification result

- Clean `npm ci`: completed from the committed lockfile.
- Unit tests: 12 suites / 107 tests passed.
- E2E tests: 4 suites / 20 tests passed, including private-mode auth/scope cases, exact
  CORS behavior, GraphQL alias rejection, production GET/introspection rejection, 2 KiB
  test body cap, Helmet headers and a deterministic 429 limit.
- Build, lint, TypeScript formatting and `git diff --check`: passed.
- Production dependency audit: 0 vulnerabilities.
- Full dependency audit: 20 moderate development-only dependency-path findings through the
  Jest/ts-jest coverage chain. The underlying `sprintf-js` advisory currently has no patched
  release; npm proposes an incompatible test-stack downgrade, so the finding is documented
  in `SECURITY.md` rather than hidden or “fixed” destructively.
- Secure Compose interpolation/schema check: passed with `docker compose ... config --quiet`.
- The Docker daemon was not running, so the NGINX container and real certificate handshake
  could not be started in this session. The candidate must perform that environment-specific
  smoke test when real certificates and a hostname exist; it is not recorded as passed here.

Additional human sign-off:

- [ ] I selected the production hostname/origin and provisioned certificate renewal.
- [ ] I generated/stored the API key outside Git and exercised one authenticated call.
- [ ] I reviewed [the scoring model](../docs/SCORING.md) and can explain one activity end to end.
