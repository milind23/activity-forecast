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

### D2. Skiing is gated on a real ski area (OpenStreetMap Overpass)
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

### D3. Surfing uses the Open-Meteo Marine API; no data → `null`
Wave height and wave period, plus wind from the main forecast. Inland points come back
from the Marine API as all-`null` series (sometimes a 400); both are treated as
`score: null`, reason `no coastal data`. `null` (cannot assess) is deliberately
different from `0` (assessed, and it's bad). A marine API failure only costs the surf
score; the rest of the response is still served.

### D4. Geocoding: Open-Meteo, top match, optional ISO country filter
`activityForecast(city, country?)`. `country` is an ISO 3166-1 alpha-2 code passed as
`countryCode` to the geocoder; we take the top result. The response returns
`country`, `countryCode` and `region` (admin1) so the caller can see *which* Paris
they got. Geocoding results are cached forever per normalised query.
Ambiguity beyond "top match" (e.g. returning candidates) is an **open question**.

### D5. Days are in the location's timezone
`timezone=auto` on the forecast and marine calls; all `date`s are local
`YYYY-MM-DD`. Hourly snow depth is aggregated per *local* day. Days that are already
in the past locally (possible when serving stale data) are dropped, so a response can
contain fewer than 7 days.

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
location share one in-flight fetch (`SingleFlight`, in-process). If the refetch fails
and we have *any* stored data, serve it with `dataFreshness.isStale = true`; only
with nothing stored do we return `UPSTREAM_UNAVAILABLE`.

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
- Apollo Sandbox embedded at `/graphql` with a pre-filled Chamonix query.
- `schema.gql` is generated from the code and committed so the contract is readable
  without running anything.
- e2e test runs the whole app with network adapters faked and `fetch` stubbed to fail.
