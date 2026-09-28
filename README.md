# O₃: Ozone Collapse

A browser game prototype about ozone depletion, UV radiation and environmental collapse.

The core loop is inspired by growth-based .io games, but the player controls an atmospheric ozone breach rather than a hole on the ground.

## Gameplay

- Move the ozone breach across the map
- Absorb ozone-depleting emitters
- Expand the ozone hole
- Increase UV footprint and intensity
- Dry and burn terrain over time
- Damage vegetation
- Zoom out as the breach grows
- Build score through environmental damage and emitter destruction

## Controls

- WASD
- Arrow keys
- Mouse movement over the terrain
- Restart button

## Run locally

Use any static local server.

### Python

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Deployment

The project is static and can be deployed directly to:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel

No build step is required.

## Stack

- HTML
- CSS
- Vanilla JavaScript
- Three.js via ES module CDN

## Current status

This is an early playable MVP focused on validating the core gameplay loop and visual feedback.
