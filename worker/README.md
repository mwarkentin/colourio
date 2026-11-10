# Prints worker

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) with an
[R2](https://developers.cloudflare.com/r2/) bucket that hosts colourio's
print files. **Order a print** uploads the print PNG here, then gives Zazzle
the file's URL, and Zazzle fetches it for the product page and the RealView
mockup.

It's one of the two upload hosts `print.js` can use; the other is Cloudinary.
Pick one with `hosting.provider` in `print.js` (see the main README's
**Prints** section).

## API

```
POST /v1/prints
  body: the PNG, with Content-Type: image/png
  → 201 {"url": "https://prints.michaelwarkentin.com/v1/prints/<uuid>.png"}
         (the URL is on whichever host the upload was sent to)

GET  /v1/prints/<uuid>.png      (HEAD works too)
  → 200 the PNG, cacheable for a year
  → 404 {"error": "not found"}

Errors: 403 for an upload from a page not in ALLOWED_ORIGINS,
        413 for a file over 20 MB,
        415 for a file that isn't a PNG,
        422 for an image over 20 megapixels or 16,384 px on a side,
        429 for more than 10 uploads a minute from one IP address.
```

**Checks.** Uploads must come from a page in `ALLOWED_ORIGINS`
(`wrangler.toml`): colourio on GitHub Pages, plus localhost for testing. The
Worker checks the PNG's signature, header and end without decoding it, and
refuses images larger than colourio ever makes. These stop other sites using
it as free image hosting, not a determined script: an `Origin` header is easy
to fake, which is what the rate limit is for.

**Files** get random UUID names, so nobody can list or guess them, and are
served as `image/png` with `nosniff`. They never change, so they're cached for
a year. Files aren't tied to people: the Worker never writes down IP
addresses or file names.

**Rate limit.** Cloudflare's
[Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
(`[[ratelimits]]` in `wrangler.toml`) allows 10 uploads a minute per IP
address. It counts separately at each Cloudflare location and errs towards
allowing requests. If the binding is removed, the Worker runs without a limit.

**Expiry.** An R2 lifecycle rule (`colourio.tf` in mwarkentin/infra) deletes files a year after
upload, so the bucket doesn't grow forever. A Zazzle product made from an
expired file stops showing the image, so don't make it much shorter until
it's clear how long Zazzle needs the file.

**Logs.** Workers Logs keeps the Worker's console output (one line per saved
file, with its size in bytes and pixels) and uncaught exceptions for a few
days. Per-request invocation logs are off in `wrangler.toml`, because they
would store each request's headers, the client's IP address included.

**Cost.** Free at colourio's scale. A print file is about 200 KB, so R2's
free 10 GB holds tens of thousands, and each print uses a couple of Worker
requests.

`src/prints.js` holds the logic and `src/index.js` only exports the Worker:
the runtime treats every export of the main module as an entry point, so
constants exported for tests can't live there.

## Setup

The Cloudflare side is managed with OpenTofu in
[mwarkentin/infra](https://github.com/mwarkentin/infra), in `colourio.tf`:
the `colourio-prints` bucket, the lifecycle rule that deletes files a year
after upload, and `colourio-prints-deploy`, an account-owned token that can
only upload Workers. The Worker's custom domain, `prints.michaelwarkentin.com`,
is there too, in `worker_domains.tf`. Changes there go through a pull request,
whose plan is applied when it merges. This repo deploys the Worker's code.

**Don't add `routes` to `wrangler.toml`.** Declaring routes there would make
wrangler the owner of the Worker's domains, and its next deploy would drop
the custom domain infra manages.

1. **Merge the infra pull request** that adds `colourio.tf`. Its apply makes
   the bucket, the rule and the token.
2. **Give GitHub the credentials.** Read the token from infra's state with
   `tofu output -raw colourio_deploy_token` (see infra's README, colourio),
   then in this repo's Settings → Secrets and variables → Actions set:
   - Secret `CLOUDFLARE_API_TOKEN`: that token.
   - Variable `CLOUDFLARE_ACCOUNT_ID`: the account ID, from the dashboard.
3. **Deploy.** The **Prints worker** workflow tests every change under
   `worker/` and deploys changes merged to `master` with
   `npx wrangler@4.151.0 deploy`; it's skipped while `CLOUDFLARE_ACCOUNT_ID`
   is unset. After step 2, run it from the Actions tab (Run workflow on
   `master`) for the first deploy. The Worker answers at
   `https://prints.michaelwarkentin.com`, and still at
   `https://colourio-prints.mwarkentin.workers.dev`.
4. **Check it** with any small PNG:

   ```sh
   curl -X POST https://prints.michaelwarkentin.com/v1/prints \
     -H 'Origin: https://mwarkentin.github.io' -H 'Content-Type: image/png' \
     --data-binary @test.png
   ```

   It answers with the file's URL; open it to see the image.
5. **Declare the domain on Zazzle:** add `prints.michaelwarkentin.com` on the
   [domains page](https://www.zazzle.com/my/ambassador/domains), with the
   same ownership option as `res.cloudinary.com`. Zazzle shows a placeholder
   instead of images from undeclared domains.

`print.js` already points `hosting.worker.url` at
`https://prints.michaelwarkentin.com`, so print files get URLs on that host.
The `workers.dev` address still answers, but nothing hands it out, so it
doesn't need declaring on Zazzle.

## Local development

```sh
cd worker
npx wrangler@4.151.0 dev --port 8787
```

`wrangler dev` uses a local R2 bucket in `.wrangler/`. To try it with
colourio, set `hosting.worker.url` to `http://localhost:8787` (with a
`zazzle.memberId` and a product's `productId`, so the dialog goes live), and
serve the site with `python3 -m http.server 8000` from the repo root. Zazzle
can't fetch files from your computer, so the RealView mockup stays hidden.

Tests run with Node's built-in test runner, with stand-ins for R2 and the
rate limiter:

```sh
node --test "worker/test/*.test.js"
```

## Removing a file

Delete a file by the UUID in its URL:

```sh
npx wrangler@4.151.0 r2 object delete colourio-prints/<uuid>.png --remote
```
