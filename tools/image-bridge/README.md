# ShortReader image bridge

ShortReader's pictures — mind maps, chapter visuals, comic panels and feed
pictures — are made in **Google Flow** or **Grok Imagine**, whichever the reader
picks in **Settings → AI Keys**. Neither has a public API for this, so they are
made the way a person would: the site opens in a real browser window (Microsoft
Edge or Google Chrome) where you sign in, and the prompt is typed and generated
for you.

**The desktop app and the web app on your computer do this themselves** — you
don't need the bridge for them. The bridge is for:

- **phones**, which can't run that browser window: the bridge runs it on a
  computer on the same network;
- **agents**: it is an MCP server, so Claude Code, Claude Desktop or any other
  MCP client can make pictures with it.

It runs the app's own image engine (`apps/readest-app/src/services/imagegen`),
so all three drive Flow and Imagine the same way. Asking for a picture opens
the site's window if needed and waits (up to 10 minutes) for you to sign in;
for Flow it then opens a project by itself.

## Run it

Needs Node.js 22.18 or newer and Edge or Chrome. No `npm install`: it has no
dependencies. Run it from a full ShortReader checkout (it uses the app's engine).

```bash
node tools/image-bridge/bridge.mjs
```

For a phone, let it listen on the network with a token:

```bash
SHORTREADER_BRIDGE_HOST=0.0.0.0 SHORTREADER_BRIDGE_TOKEN=pick-a-secret node tools/image-bridge/bridge.mjs
```

Then on the phone, **Settings → AI Keys → Pictures**: choose Google Flow or Grok
Imagine, enter `http://<computer's address>:7531` and the token, and ask for a
picture. The site opens on the computer in its own browser window, with a
profile of its own (your everyday browser profile, passwords and cookies are
never touched); sign in there once and the profile remembers it.

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
| `SHORTREADER_BRIDGE_DATA` | `%LOCALAPPDATA%\ShortReader\image-browser` (`~/.shortreader/image-browser`) | Browser profiles (shared with the web app on this computer) |

## When a site changes

The page drivers find everything by its label or text, not by class names. When
Flow or Grok Imagine redesign their pages, the place to update is the driver
scripts in [`services/imagegen/core.ts`](../../apps/readest-app/src/services/imagegen/core.ts).

Use it within each service's terms, with your own account.
