# ShortReader image bridge

ShortReader's pictures — mind maps, chapter visuals, comic panels and feed
pictures — are made in **Google Flow** or **Grok Imagine**, whichever the reader
picks in **Settings → AI Keys**. Neither has a public API for this, so the
bridge does it the way a person would: it opens the site in a real browser
window (Microsoft Edge or Google Chrome) where you are signed in, types the
prompt, presses generate and hands the finished picture back to the app.

The same bridge is also an **MCP server**, so Claude Code, Claude Desktop or any
other MCP client can make pictures with it.

## Run it

Needs Node.js 22 or newer and Edge or Chrome. No `npm install`: it has no
dependencies.

```bash
node tools/image-bridge/bridge.mjs
```

It listens on `http://127.0.0.1:7531`, the app's default. Then, in the app:

1. **Settings → AI Keys → Pictures**, choose Google Flow or Grok Imagine.
2. Press **Open**. The site opens in its own browser window, with a profile of
   its own (your everyday browser profile, passwords and cookies are never
   touched). Sign in there once; the profile remembers it.
3. For Flow, open a project (**New project**). The bridge reuses the last one.
4. Press **Check** — it should say *ready*.

Pictures are made one at a time per site. If Flow shows a CAPTCHA, the bridge
stops and says so: answer it in the Flow window. It never tries to get around one.

## Use it as an MCP server

```bash
claude mcp add shortreader-images -- node /path/to/shortreader/tools/image-bridge/bridge.mjs --mcp
```

or in a client's JSON config:

```json
{
  "mcpServers": {
    "shortreader-images": {
      "command": "node",
      "args": ["/path/to/shortreader/tools/image-bridge/bridge.mjs", "--mcp"]
    }
  }
}
```

Tools:

| Tool | What it does |
| --- | --- |
| `generate_image` | `provider` (`flow` or `imagine`), `prompt`, `aspect` (`16:9`, `9:16`, `4:3`, `3:4`, `1:1`), optional `out_path` to save it. Returns the image. |
| `open_provider` | Opens Flow or Grok Imagine in its window, to sign in. |
| `provider_status` | Whether each window is closed, waiting for sign-in, or ready. |

In MCP mode it also serves the app over HTTP when port 7531 is free.

## HTTP API

| Request | Reply |
| --- | --- |
| `GET /status` | `{ "flow": "closed" \| "signin" \| "ready", "imagine": … }` |
| `POST /open` `{ "provider": "flow" }` | Opens that window |
| `POST /generate` `{ "provider", "prompt", "aspect" }` | `{ "mimeType", "data" }` (base64) |

Browsers may call it only from the app's own origins (`tauri://localhost`,
`http(s)://tauri.localhost`, `localhost`, `127.0.0.1`), so a web page you visit
can't make pictures on your accounts.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `SHORTREADER_BRIDGE_PORT` | `7531` | HTTP port |
| `SHORTREADER_BRIDGE_HOST` | `127.0.0.1` | Set to `0.0.0.0` to reach it from a phone on the same network — then also set a token |
| `SHORTREADER_BRIDGE_TOKEN` | none | Require `Authorization: Bearer <token>`; enter the same token in the app |
| `SHORTREADER_ALLOWED_ORIGINS` | none | Extra comma-separated browser origins, e.g. where you host the web app |
| `SHORTREADER_BROWSER` | Edge, else Chrome | Path to the browser to use |
| `SHORTREADER_FLOW_PORT` / `SHORTREADER_GROK_PORT` | `9434` / `9460` | DevTools ports of the two windows |
| `SHORTREADER_BRIDGE_DATA` | `%LOCALAPPDATA%\shortreader-image-bridge` (`~/.shortreader-image-bridge`) | Browser profiles and the last Flow project |

## When a site changes

The page drivers find everything by its label or text, not by class names. When
Flow or Grok Imagine redesign their pages, the place to update is the driver
script at the top of [`src/flow.mjs`](src/flow.mjs) or [`src/grok.mjs`](src/grok.mjs).

Use it within each service's terms, with your own account.
