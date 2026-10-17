# colourio

Turn a single line of pixels from any image into a colour-stripe wallpaper.

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

## Controls

- **Hover** to sample, **click** to lock / unlock (drag on touch screens)
- **↑ ↓** (or **← →**) nudge the locked line, **Shift** for 10px steps
- **S** saves a snapshot
- **Drop** or **paste** an image anywhere to load it
