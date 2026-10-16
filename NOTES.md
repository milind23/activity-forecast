# Decision log

Newest decisions at the bottom of each day. All times IST (UTC+5:30).

## 2026-10-14

### D1. Primary view: per activity, days ranked best-first
The brief "rank how good the next 7 days are for skiing, surfing, outdoor and indoor
sightseeing" reads most naturally as *for each activity, which days are best*. So the
response has one entry per activity, its 7 days sorted best-first, plus `bestDay`.

**Alternative reading:** *for each day, which activity is best*. Both views come from
the same 4 × 7 = 28 scores, so switching or adding the other view is a presentation
change only. `bestActivityPerDay()` in `src/domain/ranking.ts` already derives it (unit
tested) but it isn't exposed in the schema yet. **Open question for the reviewer.**

Ranking details: higher score first, `null` scores last, ties broken by the earlier
date. `bestDay` is `null` when no day scores above 0 (e.g. no ski area), because
"the best of seven zeros" is not a recommendation.

### D2. Skiing is gated on a real ski area (OpenStreetMap Overpass; superseded by D17)
Weather alone would happily recommend skiing in a snowy flat city. Before scoring on
snow, we ask Overpass whether there is a `landuse=winter_sports` area or a
`piste:type=downhill` way within ~50 km (`SKI_SEARCH_RADIUS_KM`). No → score 0,
reason `no ski area nearby`. The answer is cached per location for 90 days
(`TERRAIN_CACHE_DAYS`); ski areas don't appear overnight.

Otherwise score on snow depth, fresh snowfall, temperature (and wind, for lifts).

Added during implementation (live testing showed public Overpass servers returning
504 "too busy" roughly half the time from this network):
- several Overpass endpoints, tried in order, with one retry each;
- a first-time lookup may delay the response by at most
  `TERRAIN_LOOKUP_DEADLINE_MS` (15 s). After that the request answers with skiing
  `score: null` / `ski area lookup unavailable, try again shortly`; the lookup keeps
  running in the background and its result is cached for the next request;
- failures are never cached, so the next request retries.

### D3. Surfing uses the Open-Meteo Marine API; no data → `null` (superseded by D18)
Wave height and wave period, plus wind from the main forecast. Inland points come back
from the Marine API as all-`null` series (sometimes a 400); both are treated as
`score: null`, reason `no coastal data`. `null` (cannot assess) is deliberately
different from `0` (assessed, and it's bad). A marine API failure only costs the surf
score; the rest of the response is still served.

### D4. Geocoding: Open-Meteo, top match, optional ISO country filter (superseded by D16)
`activityForecast(city, country?)`. `country` is an ISO 3166-1 alpha-2 code passed as
`countryCode` to the geocoder; we take the top result. The response returns
`country`, `countryCode` and `region` (admin1) so the caller can see *which* Paris
they got. Geocoding results are cached forever per normalised query.
Ambiguity beyond "top match" (e.g. returning candidates) is an **open question**.

### D5. Days are in the location's timezone
`timezone=auto` on the forecast and marine calls; all `date`s are local
`YYYY-MM-DD`. Hourly snow depth is aggregated per *local* day. The original implementation
dropped past dates and could return fewer than seven days; D12 records why that behavior
was replaced with a strict seven-date contract.

### D6. Storage: SQLite via TypeORM (sql.js driver); lazy refresh; no cron
**TypeORM over Prisma.** Prisma needs a `prisma generate` step and downloads a native
query engine; TypeORM plugs into Nest DI idiomatically (`@nestjs/typeorm`) and works
with **sql.js** (SQLite compiled to WebAssembly). I first tried `better-sqlite3`; it
had no prebuilt binary here and fell back to a node-gyp compile — exactly the kind of
setup friction an interviewer shouldn't hit. sql.js keeps the DB in memory and writes
the file on each change (`autoSave`), which is fine for a small cache; for real
traffic I'd switch driver (or DB) without touching the domain/application layers.
**Caveat found while testing:** because sql.js holds the whole DB in memory and rewrites
the file, two processes sharing one DB file overwrite each other's writes (seen during
`start:dev` watch restarts overlapping with a background lookup). One process per DB
file; a real multi-instance deployment needs a server DB.

Tables: `geocode_cache`, `forecast_snapshot` (raw weather + marine JSON,
`fetchedAt`), `ski_terrain`. `synchronize: true` creates them on first run — fine for
three cache tables whose content can always be refetched; migrations in production.

**Refresh:** read-through. If the stored snapshot is younger than
`FORECAST_TTL_HOURS` (3) serve it; otherwise refetch. Concurrent requests for the same
location and local date window share one in-flight fetch (`SingleFlight`, in-process).
The original fallback accepted any stored data; D12 supersedes that with a complete
seven-date coverage check.

**No cron:** we'd have to choose *which* of the world's cities to refresh. Lazy refresh
only spends API calls on locations someone actually asks about, keeps the app a single
process with no scheduler, and Open-Meteo's models only update every few hours anyway.
The cost is that the first request after expiry pays the upstream latency; a
stale-while-revalidate tweak (serve old, refresh in background) would remove that.

### D7. Scores computed at request time from stored raw data
We store the provider payloads verbatim and parse + score on every request (it's
microseconds for 28 scores). Changing a rule, a constant or which fields we read takes
effect immediately, with no refetch or backfill.

### D8. Architecture: clean architecture in Nest modules
- `domain/` — value objects and pure scoring/ranking. No Nest imports.
- `application/` — `ActivityForecastService` (use case) and port interfaces with DI
  tokens (`GEOCODER`, `WEATHER_PROVIDER`, `MARINE_PROVIDER`, `TERRAIN_PROVIDER`,
  `FORECAST_REPOSITORY`).
- `infrastructure/` — HTTP adapters (built-in `fetch`, no axios) and the TypeORM repo;
  `InfrastructureModule` binds tokens to adapters.
- `presentation/` — code-first GraphQL (Apollo), args validated with class-validator,
  application errors mapped to GraphQL error codes by an exception filter.

### D9. Scoring rules are v1 heuristics, tunable
Each activity lives in its own file under `src/domain/scoring/` with named constants at
the top and a comment block stating the rule. They're intentionally simple sums of
capped components so they're easy to reason about and adjust:

| Activity | Rule (v1) |
|---|---|
| Skiing | gate on ski area; snow base ≤45 (0 below 10 cm, full at 1 m) + fresh snow ≤25 (full at 10 cm) + temp ≤20 (max temp −12…2 °C) + calm wind ≤10; 0 with no base and no fresh snow |
| Surfing | `null` without marine data; wave height ≤50 (sweet spot 1–2.5 m, 0 if flat <0.3 m) + period ≤30 (6→12 s) + light wind ≤20 |
| Outdoor | 100 − rain ≤45 − temperature ≤30 (3/°C outside 15–26 °C) − wind ≤15 − lack of sun ≤10; thunderstorm caps at 10 |
| Indoor | `40 + (100 − outdoor) × 0.6`: always possible, better when it's grim outside |

Known caveats: see README "Scoring caveats".

### D10. DX choices
- Zero config: every env var has a default; `.env.example` documents them.
- The original Apollo Sandbox choice was removed in D11; local development now uses
  GraphiQL, while committed queries live under `examples/`.
- `schema.gql` is generated from the code and committed so the contract is readable
  without running anything.
- e2e test runs the whole app with network adapters faked and `fetch` stubbed to fail.

## 2026-10-15

### D11. Supported runtime and GraphQL stack; local explorer only
The review found that Node 20 and Apollo Server 4 were both end-of-life. The runtime is
now Node 24 LTS and the GraphQL stack is NestJS 11 + `@nestjs/graphql` 13 + Apollo Server
5. Nest 12 was tried first, and that attempt exposed ESM/CommonJS interop failures in this
project's existing runtime and Jest configuration. Nest's migration guide says CommonJS
applications can remain CommonJS on a recent Node runtime, so a full source conversion is
not inherently required. Investigating and changing that toolchain boundary was time-boxed
and rejected as unrelated volume for this exercise. Nest 11's current GraphQL integration
officially supports Apollo 5 and preserves the focused CommonJS build.

The old embedded Sandbox plugin was removed. GraphiQL and introspection are available only
outside production; example operations remain under `examples/`. A transitive GraphQL Tools
advisory was resolved with a narrow `12.1.0` override, verified by `npm run audit:prod`.

### D12. Stale fallback must still satisfy the seven-day contract
D5/D6 allowed an old snapshot to return fewer than seven future dates. That is available,
but it is not the API promised by the brief. Both freshly fetched and fallback weather must
now cover today + 6 in the location's timezone. An incomplete upstream response is not
cached. If refresh fails and the stored snapshot no longer has all seven dates, the API
returns `UPSTREAM_UNAVAILABLE`.

This chooses contract correctness over serving a partial answer during a long outage. A
future schema could explicitly model partial coverage if product wants that tradeoff.

### D13. A marine outage must not erase a useful cached forecast
The original safe-fetch path converted every Marine API error to `null`, so a transient
failure during refresh overwrote previously valid waves for the whole TTL. Refresh now
retains the last marine payload when one exists; the main weather response remains
available. A regression test covers the failure.

`dataFreshness` on the detailed forecast continues to describe atmospheric weather. D18
extends the product recommendation with activity-specific `dataAsOf`, stale evidence and
confidence. The payloads remain stored together; separate weather/marine tables would be a
production evolution if they need independent retention or refresh policy.

### D14. One local date window per request and revalidated single-flight
A slow request can cross midnight in the location's timezone. Computing the seven dates
again after an upstream call could validate one window but filter another, returning six
days. Each request now captures its window once after geocoding and uses it for cache
validation, provider validation, and output filtering.

Refreshes remain serialized by location so two windows cannot write snapshots out of order.
A caller arriving just after midnight can join the previous day's in-flight refresh, but it
revalidates the returned coverage and starts the next serialized refresh when necessary.
Clock-controlled tests cover both cases.

### D15. Separate the product decision from the detailed evidence
The ranked 4 × 7 scores explain the model but force every client to invent its own answer
to the actual product question: “what should I plan?” The primary product operation is now
`activityRecommendations(city, country?)`. For each activity, a pure domain policy maps the
best assessed score to `PLAN` (70–100), `CONSIDER` (40–69), `SKIP` (0–39), or
`UNAVAILABLE` (`null`). Only PLAN/CONSIDER receive a `recommendedDate`; a zero or unknown
score must not look bookable.

The response is deliberately focused: destination, one-line summary, four decisions,
compact provenance/live checks, and a safety/availability advisory. The existing
`activityForecast` operation remains the explicit expert/debug view with location,
freshness, and all day-level evidence. This is a GraphQL-native split: clients receive only
fields they select, without query flags that change one field's meaning.

The summary counts decisions but does not choose an overall winner because scores are
ordinal within each activity, not calibrated across different activities. “PLAN” means a
strong weather fit, not a safety guarantee or a claim that a resort/venue is open. Local
tides, warnings, avalanche conditions, access, ability and availability remain outside the
data model and are called out in `advisory`.

### D16. Normalize human country input at the application boundary
D4's alpha-2-only input was an infrastructure detail leaking into the product API. Country
now accepts a case-insensitive English name or ISO alpha-2/alpha-3 code; examples include
`India`, `INDIA`, `IN`, `IND`, `USA`, and `United States of America`. The application
normalizes these with `i18n-iso-countries` to the single alpha-2 code required by
Open-Meteo. The canonical value also keeps cache keys stable: `France`, `FR`, and `FRA`
all use the same geocode entry.

Unrecognized values fail before any upstream call with `INVALID_COUNTRY`. V1 intentionally
supports English names rather than silently guessing across locales. City-only requests
remain valid; without country, the top geocoder result still wins.

### D17. A skiing booking signal requires a venue and mountain weather
The Zermatt manual check exposed two different problems hidden by the original boolean
terrain gate. A public Overpass outage looked the same as “no resort”, and snow at the
village coordinate was not evidence for conditions on high-alpine pistes. A `SkiArea` now
records venue identity, source, representative forecast point/elevation, operating status,
and an optional official operations URL. Ski scoring uses a separately fetched and
persisted Open-Meteo payload for that mountain target.

The public Overpass API remains useful for discovery, but is not a dependable synchronous
booking dependency. A small versioned catalog makes Zermatt and Chamonix deterministic and
documents exactly which fallback destinations this take-home supports. It is deliberately
not presented as global coverage. Production evolution is a reviewed OSM/resort import in a
first-party geospatial store, refreshed offline.

Live resort operations are not inferred from snow. `OPEN` may be `READY_TO_PLAN`, `CLOSED`
always becomes `SKIP`, and `UNKNOWN` remains `VERIFY_LIVE_STATUS` with the official status
page in `checksBeforeBooking`. The bundled catalog intentionally stores `UNKNOWN`, not a
hard-coded current opening state that would become false later.

### D18. Separate forecast suitability, evidence confidence and booking readiness
One `PLAN` enum could be misread as permission to purchase. The recommendation contract now
exposes three independent ideas: `action` (weather fit), `confidence` (quality/completeness
of evidence), and `bookingReadiness` (whether live checks remain). It also exposes the
activity-specific evidence time, compact provenance, and checks required before purchase.

`NOT_APPLICABLE` and `DATA_UNAVAILABLE` are intentionally different. A successful marine
response with no coastal grid data means surfing is not applicable and scores 0; a provider
failure means it cannot be assessed and scores `null`. The same distinction applies to “no
ski area” versus a terrain lookup outage. Stored stale weather lowers confidence rather than
silently looking current.

This is booking-aware, not a booking transaction or safety certification. Tides, avalanche
bulletins, user ability, venue access, operating hours and ticket inventory remain explicit
pre-purchase checks. Deterministic GraphQL scenarios cover Zermatt mountain weather,
inland/non-ski geography, coastal surfing, provider failure and conflicting indoor/outdoor
days; domain tests cover open, closed, unknown and stale states.

### D19. Layer demand controls; make private mode explicit rather than implicit

The public take-home remains zero-config, but a deployment can now fail closed with
`AUTH_REQUIRED=true`. Service credentials are supplied from the environment, require at
least 32 characters, are compared by fixed-length SHA-256 digest with `timingSafeEqual`,
and carry explicit scopes. Both resolvers require `forecast:read`. This is intentionally a
small service-to-service mechanism, not home-grown end-user identity; a metered product
would move issuance, rotation, revocation and quotas to a managed identity/API platform.

Request volume and request shape are separate risks, so both are bounded. The app has a
per-IP 60/minute limiter, while GraphQL validation rejects documents exceeding depth 8,
15 aliases, 4 root fields or weighted cost 100 before resolver execution. Root operations
cost 20 because one may trigger several providers; bounded lists/evidence cost more than
scalars. HTTP batching stays disabled. The app limiter is intentionally in-memory for this
single-process submission; multi-instance quotas require a shared store or central gateway.

CORS is an exact allow list (empty by default), bodies default to 16 KiB, Helmet emits
baseline response protections, Express identification is disabled, and `trust proxy` is an
exact hop count rather than a boolean. Invalid security configuration aborts startup.

### D20. Terminate TLS at a real gateway; do not label it a WAF

TLS certificate lifecycle belongs at the edge, not in the Nest process. The secure Compose
profile exposes only NGINX, redirects port 80, permits TLS 1.2/1.3, and restricts the exact
GraphQL route, methods, body size, request/connection rates and timeouts. It overwrites
forwarding headers and the app trusts exactly one hop. The Node process still enforces its
own limits so a gateway mistake is not the sole boundary.

This is gateway protection, not a signature/reputation WAF. A managed WAF/DDoS product is
an honest deployment option when the hosting platform is selected, not something this repo
can claim is active. HSTS is also omitted until a permanent production hostname and working
certificate lifecycle exist; prematurely pinning HTTPS in browsers is operationally risky.

### D21. Make the score model an auditable product artifact

The comments and unit tests already defined scoring, but a reviewer should not have to
reverse-engineer four functions to understand a recommendation. `docs/SCORING.md` now
documents the exact interpolation ranges, gates, caps, missing-data assumptions, ranking,
70/40 action thresholds and the separate confidence/booking-readiness policy.

The model remains intentionally interpretable. “Sophisticated” here means using the right
weather/venue evidence, explicit uncertainty and hard feasibility overrides—not disguising
uncalibrated weights behind a machine-learning label. A later learned model requires outcome
data, policy versioning, offline evaluation and drift monitoring before it can responsibly
replace these heuristics.

### D22. Cap public discovery at three seconds on the reviewer path

A manual request exposed a repeatable ~16-second first response. The request was waiting on
the 15-second terrain deadline even though only skiing depends on public Overpass; weather
and the other activities were already available. For uncatalogued destinations the default
foreground terrain budget is now 3 seconds. The discovery continues in the background and
persists a successful result, while the response honestly marks skiing unavailable.

This is a latency cap, not the final production architecture. A global product should query
a locally imported geospatial resort index and refresh it offline. Chamonix and Zermatt
remain deterministic through the reviewed catalog, so the reviewer smoke test uses Chamonix.
