# AgentFlow

Real-time 2D visualizer for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agent sessions. Watches local JSONL session files and renders pixel-art agent sprites that walk between activity zones based on tool usage.

## How It Works

AgentFlow reads Claude Code's local session files (`~/.claude/projects/**/*.jsonl`) and maps each tool call to one of 9 activity zones. Agents appear as animated pixel-art characters that physically walk between zones as they work.

**Zones:**

| Zone | Tools | Description |
|------|-------|-------------|
| Files | Read, Write, Edit, Glob | File operations |
| Terminal | Bash | Shell commands |
| Search | Grep, WebSearch | Content search |
| Web | WebFetch, MCP browser tools | Web interactions |
| Thinking | EnterPlanMode, AskUserQuestion | Planning and reasoning |
| Messaging | SendMessage | Agent communication |
| Tasks | TaskCreate, TaskUpdate | Task management |
| Portal | Agent, TeamCreate | Agent spawn/despawn |
| Rest Area | — | Idle agents (30s timeout) |

## Features

- Programmatic 16x16 pixel-art sprites (no external assets) with idle, walk, and working animations
- 12 distinct color palettes for agents
- Role badges: MAIN, SUB, LEAD, MEMBER
- Speech bubbles showing current tool or text output
- Dashed relationship lines for parent-child and team connections
- Zone glow effects when agents are present
- Particle effects on tool use
- Pan and zoom camera controls
- HTML sidebar with agent list, zones, tools, and token counts
- Auto-reconnecting WebSocket for real-time updates

## Quick Start

```bash
git clone https://github.com/AbdullahSAhmad/agentflow.git
cd agentflow
npm install
npm run dev
```

This starts the server on `http://localhost:3333` and the client on `http://localhost:5173`.

Open the client in your browser, then use Claude Code in any terminal — agents will appear automatically.

## Prerequisites

- Node.js 18+
- npm 9+
- Claude Code installed and used at least once (so `~/.claude/` exists)

## Project Structure

```
agentflow/
├── packages/
│   ├── shared/          # @agentflow/shared — types & constants
│   │   └── src/
│   │       ├── types/       # AgentState, ZoneConfig, ServerMessage, JSONL
│   │       └── constants/   # tool-to-zone map, zone configs, color palettes
│   ├── server/          # @agentflow/server — Fastify backend
│   │   └── src/
│   │       ├── watcher/     # chokidar file watcher, JSONL parser, session scanner
│   │       ├── state/       # agent state machine with idle timers
│   │       ├── ws/          # WebSocket handler and broadcaster
│   │       └── routes/      # REST API (/api/health, /api/state)
│   └── client/          # @agentflow/client — Pixi.js frontend
│       └── src/
│           ├── sprites/     # pixel-art data, palette resolver, texture factory
│           ├── world/       # zone renderer, grid, camera, world manager
│           ├── agents/      # agent sprite, agent manager, relationship lines
│           ├── effects/     # particles, zone glow
│           ├── connection/  # WebSocket client, state store
│           └── ui/          # HTML overlay sidebar
```

## Tech Stack

- **Renderer**: [Pixi.js](https://pixijs.com/) v8 (WebGL)
- **Server**: [Fastify](https://fastify.dev/) + [@fastify/websocket](https://github.com/fastify/fastify-websocket)
- **File Watching**: [chokidar](https://github.com/paulmillr/chokidar) v3
- **Build**: [Vite](https://vite.dev/) (client), [tsx](https://github.com/privatenumber/tsx) (server)
- **Language**: TypeScript throughout

## Data Flow

```
Claude Code writes JSONL
  → chokidar detects file change
  → delta bytes read (byte-offset tracking)
  → JSONL lines parsed for tool_use / text / token_usage
  → AgentStateManager updates state + emits events
  → Broadcaster sends over WebSocket
  → Client StateStore receives + emits
  → AgentManager creates/moves/animates sprites
  → Pixi.js renders at 60fps
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health check |
| `GET /api/state` | Current agent states as JSON |
| `WS /ws` | Real-time agent events |

## License

MIT
