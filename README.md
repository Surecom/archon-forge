# Archon Forge

A chat companion for **[ArchON](https://archon.su)**: describe a change to your architecture, and an LLM agent applies it to the project you have open.

> Try ArchON online → **[https://archon.su](https://archon.su)** · Source: [https://github.com/Surecom/archon-forge](https://github.com/Surecom/archon-forge)

## What it does

- **Edits your current project.** The agent reads what is already there and changes only what you ask for — no rebuilds, no silent tidying.
- **One message = one undo step.** Everything a message changes is applied together when the agent finishes. Cmd/Ctrl+Z reverts the whole message; Stop or an error changes nothing, and Retry re-runs the message.
- **Works on your current layer.** New elements appear on the integration layer you are looking at, unless your message names another one.
- **Layout stays yours.** The agent cannot run auto layout. Use the layout button in the Forge window header when you want it.
- **Runs the tools in your browser.** `[archon-mcp](https://www.npmjs.com/package/archon-mcp)` runs as a Web Worker inside the page; every tool call executes there.



## Providers


| Provider    | Status      | Sign-in                                          |
| ----------- | ----------- | ------------------------------------------------ |
| **Cursor**  | Available   | Cursor API key (Cursor Dashboard → Integrations) |
| DeepSeek    | Coming soon | API key                                          |
| ChatGPT     | Coming soon | API key                                          |
| Claude Code | Coming soon | API key                                          |
| On-prem LLM | Coming soon | API key or login and password                    |




### How the Cursor provider works

Cursor agents run on the Cursor SDK, which needs Node.js and therefore cannot run in a browser. Forge talks to the ArchON bridge (`/api/forge/cursor/*`), which starts a Cursor agent with the model you picked and registers every archon-mcp tool as a custom tool. When the agent calls one, the bridge forwards the call to your browser, Forge runs it in the local worker and sends the result back. **Your project never leaves the browser** — the bridge only sees tool calls and their results.

You can point Forge at your own bridge in Settings → Bridge URL.

## Privacy

- Your API key is stored only in this browser's `localStorage` and sent with each request. The bridge keeps it in memory for the duration of a run and never stores or logs it.
- Chat history lives in this browser's `IndexedDB`. Clear it with the trash button in the window header.
- Nothing Forge stores goes into the project file, so collaborators never see your key or your chat.



## Setup

1. Open your project at [https://archon.su](https://archon.su) (or your own instance).
2. Install **Archon Forge** from the Marketplace in the left palette.
3. In the first-run wizard: choose **Cursor** → paste your Cursor API key → pick a model → **Save**.

If the key stops working, the settings cog in the window header blinks red.

## Examples


| You type                                                                         | Forge does                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Add a Payments system with an API and a database, and connect Orders API to it` | Adds the system and two containers on the current layer, plus one relationship |
| `Rename Orders API to Order Service and add Kafka to its technologies`           | Reads the container, then updates its name and merged technology list          |
| `Hide the Observability system on this layer`                                    | Removes it (and its containers and relationships) from the current layer only  |
| `Add a Billing system on the Payments flow layer`                                | Adds it to the named layer instead of the current one                          |




## Window

- Drag the header to move, resize from any edge, double-click the header to minimize.
- **Enter** sends, **Shift+Enter** inserts a new line; **Stop** cancels a running message.
- The window follows ArchON's theme (dark / bright) and UI language (English / Russian).



## Development

```bash
npm install
npm run typecheck
npm test               # vitest
npx vite build         # build/index.js + build/style.css
npm run package        # bump patch version, build, zip → build/archon-forge.zip
npm run package -- --no-bump   # same, keeping the current version (deliberate releases)
```

---

Built for **[ArchON](https://archon.su)** by **Surecom**.