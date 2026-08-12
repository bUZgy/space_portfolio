# Deploying the portfolio demo Worker

One Worker now serves all three live demos: sketchful.AI, the X-ray
detector, and the face attribute classifier. It holds every API
key/token as an encrypted secret so none of them appear in your site's
HTML/JS source.

## 1. Install Wrangler and log in
```bash
npm install -g wrangler
wrangler login
```

## 2. Set up the project folder
Put `worker.js` and `wrangler.toml` (both included in this package) in a
folder together, then `cd` into it.

## 3. Add your secrets
Run each of these and paste the matching value when prompted:

```bash
wrangler secret put ROBOFLOW_API_KEY
# → rf_cuCWzvHgjIaza9sZP3zI

wrangler secret put HF_TOKEN_AGE
# → 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

wrangler secret put HF_TOKEN_GENDER
# → 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

wrangler secret put HF_TOKEN_RACE
# → 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
```

None of these are stored in `wrangler.toml` or in git — they're encrypted
by Cloudflare and only injected into the Worker at runtime.

> You pasted these into our chat, so they're in this conversation's
> history. Worth regenerating all four (Roboflow key + 3 HF tokens) from
> their respective dashboards after deploying, then re-running the
> commands above with the new values. A couple minutes, no cost.

## 4. Deploy
```bash
wrangler deploy
```
You'll get one URL back, e.g.:
```
https://portfolio-demos.<your-subdomain>.workers.dev
```

This single URL serves all three routes:
- `POST /sketchful` → doodle classifier
- `POST /xray` → weapon detector
- `POST /face` → age + gender + race (all three called in parallel)

## 5. Connect it to the portfolio
Open `portfolio.html`, find near the top of the `<script>` block:
```js
const DEMO_WORKER_URL = "PASTE_YOUR_WORKER_URL_HERE";
```
Paste your Worker's base URL (no trailing slash, no route suffix — the
page code appends `/sketchful`, `/xray`, or `/face` itself). Save, and
all three "Play Demo" / "Try It" buttons go live.

## Notes
- Free tier: 100,000 requests/day on Cloudflare, Roboflow's $60/month
  free credit pool, and Hugging Face's free-tier rate limits (a few
  hundred requests/hour) — a portfolio demo won't come close to any of
  these ceilings.
- Hugging Face's free tier has cold starts on models that haven't been
  called recently (10–30s for the first request). The face demo shows a
  "waking up the models…" message to set expectations.
- If a model's response shape doesn't match what the portfolio's JS
  expects, open the browser console on the live page — it logs the raw
  JSON from each call, which makes it easy to tell me what to adjust.
