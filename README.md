# colourio

Turn a single line of pixels from any image into a colour-stripe wallpaper.

**Live at <https://mwarkentin.github.io/colourio/>**

Move over the source image to pick a row (or column) of pixels; colourio
stretches it across the whole output. Click to lock the line, then download
the result as a PNG, save snapshots, copy palette colours, or copy the line as
a CSS gradient.

## Running

It's a static page with no dependencies or build step. Serve the folder over
http so the bundled sample image can be read:

```sh
python3 -m http.server
```

Then open <http://localhost:8000>. Opening `index.html` directly works too,
but you'll need to load your own image (drop, paste, or browse).

## Deploying

Every push to `master` deploys the site to GitHub Pages via
`.github/workflows/pages.yml`. Only the files the page needs are published;
add any new site files to the "Collect site files" step. You can also run the
workflow by hand from the Actions tab.

The print upload Worker in `worker/` deploys separately, through
`.github/workflows/worker.yml`; see [worker/README.md](worker/README.md).

### Link previews

The Open Graph and Twitter card tags in `index.html` give links to colourio
a title, description and `og-image.jpg` (1200×630) in Slack, iMessage,
Bluesky, Mastodon, Threads, Reddit and Pinterest. The image is the Cosmic
Cliffs sample beside the stripes from one of its rows. `og:url` and
`og:image` must be absolute, so change both if the site moves to another
domain.

## Sharing

**Share** offers two ways to pass a session on. Neither uploads anything.

**Link** (copied, or the share sheet on phones). Everything lives in the link's
`#fragment`:

- **Samples** are shared by id along with the crop, line position, thickness,
  direction, blend and output size, so the link reopens the whole session
  exactly.
- **Your own images** can't fit in a link, so it carries the sampled line
  instead (up to 1024 colours, about 4 KB) plus the output size. The recipient
  gets the same stripes, palette and download, but not your photo.

**Photo with session.** A JPEG of the current (cropped) image, up to 2048px,
with the session's settings stored in a JPEG comment: direction, blend,
thickness, line position, output size and any sample credit. Where the browser
can share files (Safari, Chrome on Android and Windows) it goes to the share
sheet, so AirDrop, Messages or Mail can send the photo directly; elsewhere it
downloads. Dropping, pasting or opening the file in colourio restores the
session, and anywhere else it's an ordinary photo. Re-encoding drops the
original photo's metadata, such as GPS location. Chat apps that recompress
photos may strip the settings; the photo still opens.

To see what a session file holds, use **What's saved in the file?** in the
Share dialog before sending, or **View saved data** under the image after
opening one. Both show the settings in plain language plus the raw data, which
is also readable outside colourio, for example with
`identify -format "%c" file.jpg` (ImageMagick) or `exiftool -Comment file.jpg`.

## Wallpapers

**Wallpapers** makes the current stripes in the shape of each kind of screen:
the screen you're on, iPhone, Android phone, iPad (square, so it fits either
way up), MacBook, 16:9 desktop and 21:9 ultrawide. Each is as big as the
largest screen of its kind, so smaller ones scale it down instead of cropping
off the ends of the gradient. On a computer they download as one ZIP (or a
single PNG); on a phone only that phone's wallpaper is ticked, and it goes to
the share sheet so it can be saved to Photos. The sizes live in `DEVICES` at
the top of `wallpapers.js`.

## Telemetry

`telemetry.js` sends errors, performance traces, session replays, logs and
metrics to Sentry, like the games site. It does nothing until `SENTRY_DSN` is set, and only runs
on `mwarkentin.github.io/colourio`, so local previews send nothing. It loads
Sentry's SDK from `browser.sentry-cdn.com`, pinned to a version with an
integrity hash, and the deploy workflow stamps each release with its commit.

Replays cover 10% of sessions and every session with an error. People load
their own photos, so replays never record them: canvases and images are
blocked and canvas recording isn't loaded, leaving grey boxes in their place.
File names are masked (elements with `sentry-mask`, and `download`
attributes), inputs are masked by default, and no user details or IP addresses
are sent. Keep new photo or file-name UI covered by those rules.

App code reports through `window.colourioTelemetry` (`count`, `distribution`,
`info`, `warn`, `error` and `timer`), which exists even when Sentry doesn't load,
so it's safe to call anywhere. What it records:

- **Print funnel:** dialog opened, print file created or failed, uploaded or
  failed, and Zazzle opened, by product, plus print file size and how long
  rendering and uploading take. Uploads are also tagged with `upload_host`
  (`worker` or `cloudinary`). Upload and print-file failures are sent as
  errors.
- **Images:** where each image came from (`default`, `gallery`, `surprise`,
  `file_picker`, `drop`, `paste`, `share_link`), its size in megapixels, and
  how long loading takes.
- **Features:** samples chosen, settings changed, crops, snapshots, palette and
  CSS copies, PNG downloads by size, wallpapers by screen and how they were
  saved (ZIP, PNG or share sheet), and shares by method (link copied or
  through the share sheet, session file shared or downloaded).
- **Warnings** (Sentry logs): images that fail to load or aren't images,
  invalid share links, unrecognised session files, clipboard failures and share
  sheet failures. Cancelling the share sheet is counted, not logged.
- **Capabilities:** once per page load, whether the browser can share files
  and links.

Log and metric attributes may only be numbers, booleans or short identifiers
from a fixed set, such as `source: "upload"` or `size: "1920x1080"`. Anything
else, such as a file name or URL, is dropped before sending, and a
`beforeSendLog`/`beforeSendMetric` hook does the same as a backstop. Pointer
moves, individual renders and slider steps aren't recorded.

It reports to the `colourio` project in Sentry. To point it elsewhere, or turn
it off, change or empty `SENTRY_DSN`. The DSN is safe to publish.

### Feedback

The footer's "Send feedback" link (`data-feedback`) goes to this repo's issue
forms (`.github/ISSUE_TEMPLATE/`). With JavaScript, `feedback.js` opens
`#feedbackDialog` instead:

- **Once Sentry has loaded,** it's a form that sends the message and an
  optional email to Sentry's User Feedback with the last minute of the replay
  (`Sentry.captureFeedback`, in every CDN bundle). The replay keeps the rules
  above, so photos are never in it, and the form's fields are masked.
- **Either way,** it links to the Bug and Idea forms, filled in through the
  URL by their fields' ids: the device and browser, and details (the address
  without its query string or fragment, which hold share links' colours, the
  image's size, the settings, the window, the version and the user agent).
  Never the photo or its file name. From the Sentry form, the links also
  carry what was typed and the replay's id, and send the replay so far.

Keep the fields `feedback.js` fills in and the forms' ids the same.

## Analytics

`analytics.js` counts page views with
[Counterscale](https://counterscale.dev), the same self-hosted analytics as the
tools and games sites, under the site ID `colourio` at
`counterscale.mwarkentin.workers.dev`. It's separate from telemetry and only
runs on `mwarkentin.github.io/colourio`, so local previews send nothing.

What it sends, once per page load:

- The page's path, such as `/colourio/`.
- Where the visitor came from, as an origin only (`https://example.com`).
  Moves within `mwarkentin.github.io` count as no referrer.
- Counterscale adds the browser and device from the user agent, and the
  country Cloudflare works out from the IP address, which it doesn't keep.

What it doesn't send: the query string or the `#fragment`, so nothing from a
share link (sample, line, crop or sampled colours) leaves the browser; the
full referrer URL; `utm_` or `ref` parameters; or anything about images,
settings or clicks. It sets no cookies.

The tracker, `@counterscale/tracker`, is loaded from jsDelivr pinned to a
version with an integrity hash; the script fetches it so the browser checks
the hash, then imports it. Keep it on the version the Counterscale install
runs. To update, change the version in `TRACKER.src` and the hash in
`TRACKER.integrity` together, getting the hash with:

```sh
curl -s https://cdn.jsdelivr.net/npm/@counterscale/tracker@<version>/dist/module/index.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

and prefix it with `sha384-`.

## Samples

**Samples** opens a gallery of images with striking palettes, filterable by
Art, Space and Photo. Choosing one loads it, and a credit line under the
source links back to where it came from. The images live in `samples/`
(about 1600px, with thumbnails in `samples/thumbs/`), and `samples/catalog.js`
lists each one with its title, credit, palette and source.

- **Art:** public-domain paintings and prints from
  [The Met's Open Access collection](https://www.metmuseum.org/hubs/open-access)
  (CC0) and [Wikimedia Commons](https://commons.wikimedia.org/) (public domain).
  Frames and paper margins are cropped off so they don't become stripes.
- **Space:** NASA imagery. Photos taken by astronauts are public domain; the
  Webb and JPL images are free to use with the credit shown.

To add a sample, put a JPEG (about 1600px on the long side) in `samples/`, a
thumbnail (about 480px) in `samples/thumbs/`, and an entry in
`samples/catalog.js`. Use only images whose licence allows reuse, and fill in
`source`, `url` and `license`. The first entry is the image that loads on
startup.

## Prints (Zazzle)

**Order a print** renders the current stripes as a print-resolution PNG for the
chosen product, uploads it so Zazzle can fetch it, and opens Zazzle's product
page with the image on it. Zazzle handles checkout, printing and shipping, and
referred sales earn through your Zazzle Ambassador account. The dialog tells
buyers that colourio earns a commission on orders.

Out of the box it runs in **demo mode**: nothing is uploaded, and the dialog
shows the print file and the Zazzle link it would open. To go live, follow
Zazzle's [Create-a-Product API guide](https://www.zazzle.com/api) and fill in
`CONFIG` at the top of `print.js`:

1. **Zazzle account:** sign up, join the
   [Ambassador Program](https://www.zazzle.com/my/associate/associate)
   (formerly the Associates Program) and
   [accept the API terms](https://www.zazzle.com/my/associate/create_a_product_api_signup).
   Put your member account ID in `zazzle.memberId` (an 18-digit number).
2. **Keep links self-promotional:** leave `zazzle.ambassadorId` and
   `zazzle.trackingCode` blank. See [Commission](#commission) below.
3. **Declare the image domain** of your upload host (step 5) on the
   [domains page](https://www.zazzle.com/my/ambassador/domains): the Worker's
   domain, such as `colourio-prints.<your-subdomain>.workers.dev`, or
   `res.cloudinary.com`. Zazzle refuses images from undeclared domains.
4. **Store and templates:** [create a store](https://www.zazzle.com/my/store/create),
   then for each product make a design with an image placeholder the same shape
   as the product. Turn on **Make this a template object**, note its **URL
   Parameter Name** (default `image1`, goes in `imageParam`), and set fit/fill to
   **Fill**. Choose **Done → Sell It** and set **Make product a template** to
   Yes. Copy the 18-digit number at the end of the product's URL into
   `productId`. Templates can't be edited once posted, so test one before making
   the rest.
5. **Image hosting:** Zazzle fetches the image from a public URL, so
   colourio uploads it first. Set `hosting.provider` to the host you use:
   - `'worker'`: colourio's own Cloudflare Worker, which keeps files in R2.
     It checks every upload, limits uploads per visitor and deletes files
     after a year. Follow [worker/README.md](worker/README.md) to deploy it,
     then set `hosting.worker.url`.
   - `'cloudinary'`: create a Cloudinary account, add an **unsigned** upload
     preset (Settings → Upload), and set `hosting.cloudinary.cloudName` and
     `hosting.cloudinary.uploadPreset`. Anyone who reads the page source can
     use an unsigned preset, so restrict it to PNGs, a size limit and a
     folder.
6. **Test:** generate a link and compare it with Zazzle's
   [link builder](https://www.zazzle.com/my/associate/create) (Create a
   Template Link).

The link follows the guide's 1-to-1 template format:
`https://www.zazzle.com/api/create/at-{memberId}?ax=Linkover&pd={productId}&ed=true&ic={image code}&t_image1_iid={encoded image URL}`.
`rf` and `tc` are added only if `ambassadorId` or `trackingCode` is set. Once live, the dialog also
shows Zazzle's RealView mockup of the product. Products without a `productId`
stay in demo mode, so you can go live one product at a time.

### Commission

Under Zazzle's
[Ambassador Program Agreement](https://www.zazzle.com/terms/ambassadors_agreement)
(effective April 2025), the link type sets the rate. For Wall Art & Décor,
**Self-Promotion Links** to your own products, including Create-a-Product API
pages, earn 40% of net sales (royalty plus commission) but must not carry
referral parameters. Zazzle states that any link carrying your Ambassador ID
(`?rf=…`) counts as a **Cross-Promotion Link** and earns only 15%, so colourio
leaves `rf` out by default. It also leaves out the tracking code (`tc`), which
feeds your referral history and might be treated the same way, and keeps the
image code (`ic`), which feeds your royalty history. Worth confirming with
Zazzle Developer Support (api.help@zazzle.com) that a linkover without `rf` or
`tc` earns the Self-Promotion rate, and whether `tc` is safe to add back. See the
[commission table](https://www.zazzle.com/hc/article/ambassador_referral_commissions_creator_royalties-30810357489175)
for current rates.

Other terms worth knowing:

- **No prices** on your site: Zazzle sets and changes them.
- **Brand use:** no paid ads or keyword bids on "Zazzle", no "Zazzle" in a
  domain, no implied partnership, and logos only under Zazzle's trademark
  guidelines.
- **Disclosure:** the print dialog says colourio earns a commission. Keep it
  if you change the dialog.
- **Payouts** are on net sales (excluding shipping, tax and refunds) after
  delivery and payment, tracked by a 45-day cookie. Your own test orders may
  not earn anything.
- **Royalties** above the standard rate can incur Excess Royalty Fees; see the
  Creator License Agreement before raising yours.
- **Terms** can change on 48 hours' notice, and violations can forfeit earned
  commissions.

## Nanoleaf

`nanoleaf/nanoleaf.mjs` shows a colourio gradient on Nanoleaf lights, such as
a Skylight: click **Copy CSS**, then run
`node nanoleaf/nanoleaf.mjs send` on a computer on the same Wi-Fi. Each panel
gets the average colour of its stretch of the gradient, or with `--drift` the
gradient flows along the panels. See [nanoleaf/README.md](nanoleaf/README.md)
to pair it with your lights.

## Controls

- **Hover** to sample, **click** to lock / unlock (drag on touch screens)
- **↑ ↓** (or **← →**) nudge the locked line, **Shift** for 10px steps
- **S** saves a snapshot; click a snapshot's label to restore its position and settings
- **Drop** or **paste** an image anywhere to load it
- **Share** copies a link to the session, or sends the photo with the session saved inside it
- **Crop** (next to the lock) trims the source: drag the box or its handles, or drag
  on the image to draw a new box; pick an aspect ratio; **Enter** applies, **Esc** cancels.
  Cropping isn't destructive, so you can reopen it and widen the box again
