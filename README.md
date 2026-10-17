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
shows the print file and the Zazzle link it would open. To go live, follow
Zazzle's [Create-a-Product API guide](https://www.zazzle.com/api) and fill in
`CONFIG` at the top of `print.js`:

1. **Zazzle account:** sign up, join the
   [Associates Program](https://www.zazzle.com/my/associate/associate) and
   [accept the API terms](https://www.zazzle.com/my/associate/create_a_product_api_signup).
   Put your member account ID in `zazzle.memberId` and your associate ID in
   `zazzle.associateId` (both 18-digit numbers).
2. **Declare the image domain:** add `res.cloudinary.com` on the
   [domains page](https://www.zazzle.com/my/associate/domains). Zazzle refuses
   images from undeclared domains.
3. **Store and templates:** [create a store](https://www.zazzle.com/my/store/create),
   then for each product make a design with an image placeholder the same shape
   as the product. Turn on **Make this a template object**, note its **URL
   Parameter Name** (default `image1`, goes in `imageParam`), and set fit/fill to
   **Fill**. Choose **Done → Sell It** and set **Make product a template** to
   Yes. Copy the 18-digit number at the end of the product's URL into
   `productId`. Templates can't be edited once posted, so test one before making
   the rest.
4. **Image hosting:** Zazzle fetches the image from a public URL. Create a
   Cloudinary account, add an **unsigned** upload preset (Settings → Upload),
   and set `cloudinary.cloudName` and `cloudinary.uploadPreset`. Anyone who
   reads the page source can use an unsigned preset, so restrict it to PNGs, a
   size limit and a folder.
5. **Test:** generate a link and compare it with Zazzle's
   [link builder](https://www.zazzle.com/my/associate/create) (Create a
   Template Link).

The link follows the guide's 1-to-1 template format:
`https://www.zazzle.com/api/create/at-{memberId}?rf={associateId}&ax=Linkover&pd={productId}&ed=true&tc=colourio&ic={image code}&t_image1_iid={encoded image URL}`.
Once live, the dialog also shows Zazzle's RealView mockup of the product.
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
