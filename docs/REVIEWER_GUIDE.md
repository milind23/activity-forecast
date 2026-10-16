# Reviewer guide

This is the shortest reproducible path from a fresh clone to a live result. No API keys,
database server or `.env` file are required for local evaluation. The application calls
live Open-Meteo services, so the live smoke test requires outbound internet access; all
automated tests replace external HTTP with deterministic fakes.

## 1. Prerequisites

- Git
- Node.js 24+ and npm, or Docker with Compose
- `curl` for the provided smoke-test script

The repository includes `.nvmrc`, so an `nvm` user can run `nvm install && nvm use`.

## 2. Clone, install and verify

```bash
git clone https://github.com/milind23/activity-forecast.git
cd activity-forecast
nvm use                       # optional; use any Node.js 24+ installation
npm ci
npm run verify
```

`npm ci` installs the exact committed lockfile. `npm run verify` checks formatting, lint,
build, 107 unit tests, 20 deterministic HTTP/GraphQL tests and the production dependency
audit. The full development tree has a documented Jest/ts-jest advisory exception in
`SECURITY.md`; it is not present in the production image.

## 3. Start the service

Development mode provides GraphiQL:

```bash
npm run start:dev
```

Wait for:

```text
GraphQL endpoint: http://localhost:3000/graphql
```

Alternatively, exercise the compiled production entrypoint:

```bash
npm run build
npm run start:prod
```

Local/reviewer mode intentionally leaves API-key authentication disabled. Production
security configuration is separate and documented in `SECURITY.md`.

## 4. Get a live recommendation

In a second terminal:

```bash
./examples/query.sh
```

The default operation asks for Chamonix, France. Chamonix is in the small reviewed ski-area
catalog, making it the most deterministic live demonstration: it avoids public Overpass
discovery and obtains skiing weather from a representative mountain elevation.

Expected contract—not fixed weather values:

- HTTP 200 and a top-level `data.activityRecommendations` value;
- destination resolves to Chamonix, France;
- exactly four recommendations: skiing, surfing, outdoor sightseeing and indoor sightseeing;
- each recommendation has an action, booking readiness, confidence, score/date when
  assessable, human-readable evidence and required pre-booking checks;
- current dates and scores vary because the providers are live.

To run other examples:

```bash
./examples/query.sh recommendations.graphql  # Mumbai, lean product response
./examples/query.sh biarritz.graphql          # detailed coastal ranking
./examples/query.sh madrid.graphql             # detailed inland ranking
```

An uncatalogued destination may return skiing as `DATA_UNAVAILABLE` while public Overpass
discovery continues in the background. That is a deliberate truthful partial result; it
does not prevent the other three activities from being recommended. The foreground wait is
capped at three seconds and any completed terrain result is persisted for later requests.

## 5. Postman alternative

Create a `POST` request to `http://localhost:3000/graphql`, set
`Content-Type: application/json`, select **Body → raw → JSON**, and paste:

```json
{
  "query": "query ReviewerDemo($city: String!, $country: String) { activityRecommendations(city: $city, country: $country) { destination summary recommendations { activity action bookingReadiness confidence recommendedDate score dataAsOf message evidence checksBeforeBooking } advisory } }",
  "variables": {
    "city": "Chamonix",
    "country": "France"
  }
}
```

## 6. Docker alternative

Do not run the Node and Docker versions simultaneously because both use port 3000.

```bash
docker compose up --build
./examples/query.sh
docker compose down
```

The Docker image runs in production mode, so GraphiQL and introspection are disabled; POST
requests still work. The first command may take longer while Docker downloads/builds images.

## 7. Where to review the engineering work

1. `NOTES.md` — chronological architecture decisions and rejected alternatives.
2. `ai-sessions/README.md` — honest human-led, AI-assisted work trail and provenance gaps.
3. `docs/SCORING.md` — exact score formulas, hard gates and recommendation thresholds.
4. `qa/booking-recommendation-matrix.md` — product/failure-mode scenarios.
5. `SECURITY.md` — enforced NFRs and the secure TLS gateway profile.
6. `schema.gql` — generated GraphQL contract.

## Troubleshooting

- `npm ci` rejects the runtime: confirm `node --version` is 24 or newer.
- Port 3000 is busy: stop the other process or set `PORT=3001` and run the script with
  `URL=http://localhost:3001/graphql`.
- Live request reports `UPSTREAM_UNAVAILABLE`: verify outbound access to Open-Meteo and retry;
  deterministic tests do not require those services.
- An uncatalogued city's skiing result is unavailable: this is isolated public Overpass
  capacity, not a failure of the other recommendations. Use the default Chamonix smoke test
  for the catalog-backed path.
