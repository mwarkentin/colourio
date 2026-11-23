# Nanoleaf

Shows a colourio gradient on Nanoleaf lights, such as a Skylight, using the
lights' local API. It's a script you run on a computer on the same Wi-Fi as
the lights: colourio itself can't do it, because browsers don't let a secure
website like colourio talk to devices on your home network.

It needs [Node.js](https://nodejs.org/) 18 or later and nothing else.

## Pair (once)

1. **Find the lights' IP address**, for example in your router's list of
   devices. On a Mac you can also browse for them with
   `dns-sd -B _nanoleafapi._tcp`, then get the address with
   `dns-sd -L "<name it shows>" _nanoleafapi._tcp`.
2. **Open pairing:** in the Nanoleaf app, open the Skylight's settings and tap
   **Connect to API**. Other Nanoleaf panels open pairing by holding the power
   button for 5–7 seconds.
3. **Within 30 seconds**, from the repo folder:

   ```sh
   node nanoleaf/nanoleaf.mjs pair 192.168.1.40
   ```

The address and token are saved in `~/.config/colourio/nanoleaf.json`, readable
only by you. Anyone with the token can control the lights from your network,
so keep it to yourself. If the lights get a new address, pair again.

## Send a gradient

Click **Copy CSS** in colourio, then:

```sh
node nanoleaf/nanoleaf.mjs send
```

With no colours given, it reads the clipboard. It also takes the colours as
an argument: the CSS, a colourio share link to your own photo (those carry
the colours; links to samples don't, so use Copy CSS for those), or hex
colours:

```sh
node nanoleaf/nanoleaf.mjs send "#ff0000 #00ff00 #0000ff"
```

That last one is a handy check: red should be on the panel where you want
the gradient to start. If it's at the other end, add `--reverse`.

Options:

- `--drift`: instead of holding still, the gradient flows along the panels
  and back. Every panel passes through all of it, 24 colours each way,
  fading smoothly from one to the next.
- `--cycle <seconds>`: about how long one flow takes, out and back (default
  60).
- `--reverse`: start the gradient at the other end of the panels.
- `--save <name>`: also save it as a scene on the lights, where it shows up
  in the Nanoleaf app, and in your scene library on this computer. See
  [Saved scenes](#saved-scenes). Without `--save`, the gradient shows until
  you choose another scene.

`node nanoleaf/nanoleaf.mjs layout` lists the panels in the order the gradient
runs.

## Saved scenes

Scenes saved on the lights can be lost: a factory reset or a firmware update
can clear them, and they're easy to delete in the app. So `--save` also keeps
a copy in a scene library on your computer:

```sh
node nanoleaf/nanoleaf.mjs send --save "Pier at sunset"
```

Then:

- `scenes` lists them, with a preview of each gradient if your terminal
  shows colour.
- `play <name>` shows one. Add `--save` to save it on the lights again too.
- `sync` puts every scene in the library back on the lights, for example
  after a reset or on new lights. It replaces scenes with the same names, and
  doesn't change what's showing.
- `forget <name>` removes one from the library. A copy saved on the lights
  stays until you delete it in the app.

```sh
node nanoleaf/nanoleaf.mjs scenes
node nanoleaf/nanoleaf.mjs play pier at sunset
```

With `play` and `forget`, names don't need quotes and any case works. If a
name isn't found, the script suggests close ones. Names can be up to 40
characters.

The library keeps each scene's gradient and options, not the colour of each
panel. So a scene plays on any lights: after you add or rearrange panels, or
move to new lights, `play` and `sync` fit it to the panels there now. The
lights have to be paired, as for `send`.

The library is `~/.config/colourio/nanoleaf-scenes.json`, a plain JSON file
apart from the token in `nanoleaf.json`, so you can back it up or copy it to
another computer without sharing the token. It's readable only by you, and
it's written so that a crash midway can't damage it. If it does get damaged,
for example by a mistake when editing it by hand, the script says so and
leaves it alone.

If the previews don't show up but your terminal does show 24-bit colour, set
`FORCE_COLOR=3`.

## How colours are chosen

The panels are lined up along the longer side of their layout, as arranged in
the Nanoleaf app, and the gradient is stretched across them. Each panel
shows one colour: the average of the part of the gradient it covers. So three
panels in a line show the gradient's first, middle and last thirds. Panels
side by side across the line share a colour.

With `--drift`, the gradient is cut into 24 colours (as many as colourio's
Copy CSS gives) and each panel steps through all of them, out and back. The
panels stay as far apart in the gradient as they are on the ceiling: with
three in a line, each is a third of the way along from the next, so the
colours visibly flow from one panel to the next.

Each Skylight panel shows a single colour, lit from its edges, so gradients
are coarse with few panels. `--drift` shows all of it over time.
Dark gradients make dim panels; the lights' overall brightness stays as set
in the Nanoleaf app.

## Tests

```sh
node --test "nanoleaf/test/*.test.mjs"
```

They run against a small stand-in for a three-panel Skylight, and keep scene
libraries in temporary folders. The effect format follows Nanoleaf's OpenAPI
documentation but hasn't been tried on every model.
