# Uptime watchdog (Cloudflare Worker)

Checks the ERP every minute from outside Railway. If the ERP stays down for
10 minutes, every customer gets one "technical problem, sorry" email and you
get an alert. When it answers again they get one "back online" email.
Planned maintenance announced from Platform Console → Notices is recognised,
so customers are not emailed twice.

## One-time setup

1. **Railway** → service Variables → add `WATCHDOG_TOKEN` = any long random
   string (at least 16 characters, e.g. from a password generator). Redeploy.
2. In this folder:

   ```sh
   npx wrangler login                       # opens Cloudflare in the browser
   npx wrangler kv namespace create STATE   # copy the printed id into wrangler.toml
   npx wrangler secret put BREVO_API_KEY    # same key as BREVO_API_KEY on Railway
   npx wrangler secret put WATCHDOG_TOKEN   # same value as step 1
   npx wrangler deploy
   ```

3. Check `SENDER_EMAIL` and `OWNER_EMAIL` in `wrangler.toml` first.
   `SENDER_EMAIL` must be a sender verified in Brevo.

4. Open the worker's URL (printed by `deploy`). It shows `"up": true` and,
   within a few minutes, the number of customers it has on file.

## Test

`node --test test.mjs` runs the logic against a fake ERP and fake Brevo
(no real emails): down → customers told once → back up → "back online" once,
and planned maintenance → owner only.
