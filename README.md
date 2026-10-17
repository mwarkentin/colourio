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

## Prints (Zazzle)

**Order a print** renders the current stripes as a print-resolution PNG for the
chosen product, uploads it to Cloudinary, and opens Zazzle's product page with
the image on it. Zazzle handles checkout, printing and shipping, and referred
sales earn on your Zazzle associate account.

Out of the box it runs in **demo mode**: nothing is uploaded, and the dialog
shows the print file and the Zazzle link it would open. To go live, fill in
`CONFIG` at the top of `print.js`:

1. **Associate ID:** join Zazzle's associate/ambassador program and copy your
   associate ID into `zazzle.associateId`.
2. **Product templates:** for each product, create a design on Zazzle with an
   image object, publish it as a template, and copy its product ID into that
   product's `productId`. If you rename the image object, set `imageParam` to
   its URL parameter name (Zazzle's default is `image1`). Keep `width` and
   `height` (inches) matching the product so the print file fits.
3. **Image hosting:** Zazzle fetches the image from a public URL. Create a
   Cloudinary account, add an **unsigned** upload preset (Settings → Upload),
   and set `cloudinary.cloudName` and `cloudinary.uploadPreset`. An unsigned
   preset can be used by anyone who reads the page source, so restrict it to
   PNGs, a size limit and a folder.
4. **Check the link:** the link format follows Zazzle's Create-a-Product API
   guide (`/api/create/at-…?ax=Linkover&pd=…&t_image1_url=…`). Compare it with
   the link builder in your Zazzle account before launch.

Products without a `productId` stay in demo mode, so you can go live one
product at a time.

## Controls

- **Hover** to sample, **click** to lock / unlock (drag on touch screens)
- **↑ ↓** (or **← →**) nudge the locked line, **Shift** for 10px steps
- **S** saves a snapshot; click a snapshot's label to restore its position and settings
- **Drop** or **paste** an image anywhere to load it
- **Crop** (next to the lock) trims the source: drag the box or its handles, or drag
  on the image to draw a new box; pick an aspect ratio; **Enter** applies, **Esc** cancels.
  Cropping isn't destructive, so you can reopen it and widen the box again
