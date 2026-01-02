---
summary: "Top-level overview of Clawdis, features, and purpose"
read_when:
  - Introducing Clawdis to newcomers
---
<!-- {% raw %} -->
# CLAWDIS 🦞

> *"EXFOLIATE! EXFOLIATE!"* — A space lobster, probably

<p align="center">
  <img src="whatsapp-clawd.jpg" alt="CLAWDIS" width="420">
</p>

<p align="center">
  <strong>WhatsApp + Telegram + Discord + iMessage gateway for AI agents (Pi).</strong><br>
  Send a message, get an agent response — from your pocket.
</p>

<p align="center">
  <a href="https://github.com/steipete/clawdis">GitHub</a> ·
  <a href="https://github.com/steipete/clawdis/releases">Releases</a> ·
  <a href="./clawd.md">Clawd setup</a>
</p>

CLAWDIS bridges WhatsApp (via WhatsApp Web / Baileys), Telegram (Bot API / grammY), Discord (Bot API / discord.js), Mattermost (client API), and iMessage (imsg CLI) to coding agents like [Pi](https://github.com/badlogic/pi-mono).
It’s built for [Clawd](https://clawd.me), a space lobster who needed a TARDIS.

## How it works

```
WhatsApp / Telegram / Discord
        │
        ▼
  ┌──────────────────────────┐
  │          Gateway          │  ws://127.0.0.1:18789 (loopback-only)
  │     (single source)       │  tcp://0.0.0.0:18790 (Bridge)
  │                          │  http://<gateway-host>:18793/__clawdis__/canvas/ (Canvas host)
  └───────────┬───────────────┘
              │
              ├─ Pi agent (RPC)
              ├─ CLI (clawdis …)
              ├─ Chat UI (SwiftUI)
              ├─ macOS app (Clawdis.app)
              └─ iOS node via Bridge + pairing
```

Most operations flow through the **Gateway** (`clawdis gateway`), a single long-running process that owns provider connections and the WebSocket control plane.

## Network model

- **One Gateway per host**: it is the only process allowed to own the WhatsApp Web session.
- **Loopback-first**: Gateway WS defaults to `ws://127.0.0.1:18789`.
  - For Tailnet access, run `clawdis gateway --bind tailnet --token ...` (token is required for non-loopback binds).
- **Bridge for nodes**: optional LAN/tailnet-facing bridge on `tcp://0.0.0.0:18790` for paired nodes (Bonjour-discoverable).
- **Canvas host**: HTTP file server on `canvasHost.port` (default `18793`), serving `/__clawdis__/canvas/` for node WebViews; see `docs/configuration.md` (`canvasHost`).
- **Remote use**: SSH tunnel or tailnet/VPN; see `docs/remote.md` and `docs/discovery.md`.

## Features (high level)

- 📱 **WhatsApp Integration** — Uses Baileys for WhatsApp Web protocol
- ✈️ **Telegram Bot** — DMs + groups via grammY
- 🎮 **Discord Bot** — DMs + guild channels via discord.js
- 💬 **iMessage** — Local imsg CLI integration (macOS)
- 📧 **Mattermost Bot** — DMs + channel messages via Mattermost client
- 🤖 **Agent bridge** — Pi (RPC mode) with tool streaming
- 💬 **Sessions** — Direct chats collapse into shared `main` (default); groups are isolated
- 👥 **Group Chat Support** — Mention-based by default; owner can toggle `/activation always|mention`
- 📎 **Media Support** — Send and receive images, audio, documents
- 🎤 **Voice notes** — Optional transcription hook
- 🖥️ **WebChat + macOS app** — Local UI + menu bar companion for ops and voice wake
- 📱 **iOS node** — Pairs as a node and exposes a Canvas surface

Note: legacy Claude/Codex/Gemini/Opencode paths have been removed; Pi is the only coding-agent path.

## Quick start

Runtime requirement: **Node ≥ 22**.

```bash
# From source (recommended while the npm package is still settling)
pnpm install
pnpm build
pnpm link --global

# Pair WhatsApp Web (shows QR)
clawdis login

# Run the Gateway (leave running)
clawdis gateway --port 18789
```

Send a test message (requires a running Gateway):

```bash
clawdis send --to +15555550123 --message "Hello from CLAWDIS"
```

## Configuration (optional)

Config lives at `~/.clawdis/clawdis.json`.

- If you **do nothing**, CLAWDIS uses the bundled Pi binary in RPC mode with per-sender sessions.
- If you want to lock it down, start with `routing.allowFrom` and (for groups) mention rules.

Example:

```json5
{
  routing: {
    allowFrom: ["+15555550123"],
    groupChat: { requireMention: true, mentionPatterns: ["@clawd"] }
  }
}
```

## Docs

- Start here:
  - [FAQ](./faq.md) ← *common questions answered*
  - [Configuration](./configuration.md)
  - [Nix mode](./nix.md)
  - [Clawd personal assistant setup](./clawd.md)
  - [Skills](./skills.md)
  - [Skills config](./skills-config.md)
  - [Workspace templates](./templates/AGENTS.md)
  - [RPC adapters](./rpc.md)
  - [Gateway runbook](./gateway.md)
  - [Nodes (iOS/Android)](./nodes.md)
  - [Web surfaces (Control UI)](./web.md)
  - [Discovery + transports](./discovery.md)
  - [Remote access](./remote.md)
- Providers and UX:
  - [WebChat](./webchat.md)
  - [Control UI (browser)](./control-ui.md)
  - [Telegram](./telegram.md)
  - [Discord](./discord.md)
  - [iMessage](./imessage.md)
  - [Groups](./groups.md)
  - [WhatsApp group messages](./group-messages.md)
  - [Media: images](./images.md)
  - [Media: audio](./audio.md)
- Ops and safety:
  - [Sessions](./session.md)
  - [Cron + wakeups](./cron.md)
  - [Security](./security.md)
  - [Troubleshooting](./troubleshooting.md)

## The name

**CLAWDIS = CLAW + TARDIS** — because every space lobster needs a time-and-space machine.

---

*"We're all just playing with our own prompts."* — an AI, probably high on tokens
<!-- {% endraw %} -->

## Credits

- **Peter Steinberger** ([@steipete](https://twitter.com/steipete)) — Creator, lobster whisperer
- **Mario Zechner** ([@badlogicc](https://twitter.com/badlogicgames)) — Pi creator, security pen-tester
- **Clawd** — The space lobster who demanded a better name

## License

MIT — Free as a lobster in the ocean 🦞

---

*"We're all just playing with our own prompts."* — An AI, probably high on tokens
