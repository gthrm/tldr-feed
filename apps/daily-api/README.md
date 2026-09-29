# daily-api

The evening run and the sign-up endpoints. One process, one job a day.

```
21:10 Europe/Belgrade
  fetch (packages/sources) → dedupe → rank → classify → extract → summarize
    → the day is written to Neon
    → the static site is rebuilt into SITE_OUT
    → the digest goes out through Resend
```

Everything that needs the database happens inside that one window. Neon's free
plan suspends a compute after five minutes idle and bills for the time it is
awake, so the cost is the number of wake-ups, not the number of rows — one a
day. `src/jobs/daily.job.spec.ts` asserts the round-trip count so the budget
cannot quietly drift.

## By hand

```bash
npm run job -- --preview                    # what the day holds, headlines only, free
npm run job -- --dry-run --skip-build       # full run, writes nothing, sends nothing
npm run job -- --day 2026-09-28             # the real thing
npm run db:migrate                          # apply migrations to DATABASE_URL
```

## Endpoints

| | |
| --- | --- |
| `POST /api/subscriptions` | the form: double opt-in, 5/hour per IP, honeypot |
| `GET /api/subscriptions/confirm/:token` | the link in the confirmation email |
| `GET,POST /api/subscriptions/unsubscribe/:token` | the link, and one-click for mail clients |
| `GET /api/health` | never touches the database — see the comment in the controller |

Configuration lives in `src/config/configuration.ts`; the two settings that do
not are named in the comment at the top of it.

## Email delivery

`MAIL_DRY_RUN=1` disables both confirmation emails and daily digests. The signup
form still shows “Check your inbox”, but the confirmation link is only logged.
To enable delivery, set `MAIL_DRY_RUN=0`, `RESEND_API_KEY`, and `MAIL_FROM` (using
a domain verified in Resend) in the server's `.env`.
With dry run disabled, a missing API key is an error rather than a simulated send.

After changing `.env` or mail code, recreate the API container from the repository
root so it picks up the settings and rebuilt templates:

```bash
docker compose up -d --build --no-deps daily-api
```

Submit the signup form again to request a confirmation for a pending address.
Daily digests only go to confirmed subscribers at 21:10 Europe/Belgrade.
