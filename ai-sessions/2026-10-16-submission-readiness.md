# Submission-readiness log — 2026-10-16 IST

This is a chronological working summary, not a reconstructed verbatim AI transcript.

## Human prompts that changed the submission

1. The candidate observed that a real GraphQL response took roughly 16 seconds and asked
   why. Inspection tied that directly to the configured 15-second foreground terrain lookup
   deadline for uncatalogued cities.
2. The candidate then asked to submit the assignment and make the download/build/run/result
   path explicit for the interviewer.

## Decisions and changes

- Reduced the foreground public terrain-discovery budget from 15 seconds to 3 seconds.
  This keeps the other three activity decisions responsive; Overpass continues in the
  background and a successful result is persisted. It does not disguise missing ski data.
- Added `examples/reviewer-demo.graphql`, using catalog-backed Chamonix so the canonical
  smoke test does not depend on public Overpass.
- Made that operation the default for `examples/query.sh`; retained Mumbai and detailed
  scenario queries as explicit alternatives.
- Added optional `API_KEY` support to the same script for secure-profile testing.
- Added `npm run verify` as the one-command local equivalent of the CI gates.
- Added `docs/REVIEWER_GUIDE.md` covering fresh clone, Node, production build, Postman,
  Docker, expected response invariants and common failure modes.
- Linked the reviewer guide prominently from the README and updated the current latency
  caveat. D22 records why the limit changed.

## Repository state discovered before publication

- The current branch is `main`.
- No Git remote is configured, so no public GitHub destination exists yet.
- The booking-grade/security/submission changes are uncommitted. The candidate must review
  the diff and complete the sign-off before creating the final commit and public remote.

## Verification performed after the documentation change

- `bash -n examples/query.sh`: passed; the script remains executable.
- `npm run verify`: passed — formatting, lint, build, 12 unit suites / 107 tests,
  4 e2e suites / 20 tests, and 0 production dependency vulnerabilities.
- `./examples/query.sh`: passed against the locally running service and live providers in
  2.85 seconds. It returned Chamonix plus all four recommendations, mountain-elevation ski
  evidence, booking readiness, confidence and live-check guidance.
- `git diff --check`: passed.
- Docker runtime was not re-tested because the local daemon remains unavailable; Compose
  configuration had already passed validation. This remains a human pre-submission check.

## Publication and CI follow-up

- The candidate authorized creation of the public repository
  `https://github.com/milind23/activity-forecast` and a push of `main`.
- Commit `aa157e0` was pushed, and a fresh public clone passed `npm ci` plus the full
  `npm run verify` gate: formatting, lint, build, 107 unit tests, 20 end-to-end tests and
  zero production dependency vulnerabilities.
- The first Ubuntu GitHub Actions run failed before tests because `npm ci` found two
  platform-resolved optional peer packages missing from the macOS-generated lockfile:
  `@emnapi/core` and `@emnapi/runtime`. This was a lockfile portability issue, not a test
  or application failure.
- A clean lockfile was regenerated from `package.json` in an empty temporary directory.
  The replacement was also validated using Linux resolution with
  `npm ci --package-lock-only --ignore-scripts --os=linux --cpu=x64` before committing.
  CI success is intentionally not claimed in this note until GitHub runs the corrective
  commit.

## Human sign-off still required before submission

- [ ] I ran `npm ci` and `npm run verify` myself from the final tree.
- [ ] I started the service and ran `./examples/query.sh` myself.
- [ ] I reviewed the API output and can explain one score end to end.
- [ ] I reviewed the final diff and every decision I am presenting as mine.
- [ ] I completed the earlier booking/security sign-off fields and recorded actual time.
- [ ] I confirmed no `.env`, certificate, SQLite database or credential is staged.
- [ ] I created the public GitHub repository and tested its clone URL in a new directory.
- [ ] Name/date: `________________________________`.
