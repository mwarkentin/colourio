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
  and back, so every part of it passes across the ceiling. Each panel fades
  smoothly from one colour to the next.
- `--cycle <seconds>`: how long one flow takes, out and back (default 60).
- `--reverse`: start the gradient at the other end of the panels.
- `--save <name>`: also save it as a scene on the lights, rather than only
  showing it. Whether saved scenes show up in the Nanoleaf app hasn't been
  checked yet. Without it, the gradient shows until you choose another scene.

`node nanoleaf/nanoleaf.mjs layout` lists the panels in the order the gradient
runs.

## How colours are chosen

The panels are lined up along the longer side of their layout, as arranged in
the Nanoleaf app, and the gradient is stretched across them. Each panel
shows one colour: the average of the part of the gradient it covers. So three
panels in a line show the gradient's first, middle and last thirds. Panels
side by side across the line share a colour.

Each Skylight panel shows a single colour, lit from its edges, so gradients
are coarse with few panels. `--drift` shows more of the gradient over time.
Dark gradients make dim panels; the lights' overall brightness stays as set
in the Nanoleaf app.

## Tests

```sh
node --test "nanoleaf/test/*.test.mjs"
```

They run against a small stand-in for a three-panel Skylight. The effect
format follows Nanoleaf's OpenAPI documentation but hasn't been tried on every
model.
