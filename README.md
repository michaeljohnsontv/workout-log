(note: app created primarily by Claude Code. README created by Claude Code.)
# Workout Log

An ink-first workout grid for iPad + Apple Pencil. A frozen left column holds the exercises (handwritten); one column per day scrolls sideways. Pencil writes, fingers scroll. No keyboard anywhere.

Plain HTML/CSS/JS, no build step. Data stays on the device (IndexedDB); use **⋯ → Export backup** now and then.

## Install on the iPad
1. Open the GitHub Pages URL in Safari.
2. Share → **Add to Home Screen**.
3. Launch it from the home screen icon (it works offline after the first load).

Data saved in the home-screen app is separate from data in a regular Safari tab, so always use the icon.

## Run locally
```
python -m http.server 8123
```
then open http://localhost:8123. A mouse draws like the Pencil.

## Updating
After changing files, bump `CACHE` in `sw.js` so installed copies pick up the change (they update on the next launch after that).
