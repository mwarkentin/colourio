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

## Controls

- **Hover** to sample, **click** to lock / unlock (drag on touch screens)
- **↑ ↓** (or **← →**) nudge the locked line, **Shift** for 10px steps
- **S** saves a snapshot; click a snapshot's label to restore its position and settings
- **Drop** or **paste** an image anywhere to load it
- **Crop** (next to the lock) trims the source: drag the box or its handles, or drag
  on the image to draw a new box; pick an aspect ratio; **Enter** applies, **Esc** cancels.
  Cropping isn't destructive, so you can reopen it and widen the box again
