# Vision One MCP Chatbot

<p align="center">
  <img src="https://github.com/andrefernandes86/demo-ai-guard/blob/main/ai0rd.png" alt="Vision One MCP Chat" width="600">
</p>

This project is a web-based chatbot that connects to the **Trend Micro Vision One MCP Server** using **Model Context Protocol (MCP)** over `stdio`.  
It allows natural language queries against Vision One tools such as Workbench, CREM, CAM, Container Security, and Endpoint Security — powered by a local or remote **Ollama** LLM.

---

## Features

- Interactive web chat UI
- MCP stdio connection to Vision One MCP Server (runs in Docker)
- Configurable Vision One region & API key
- Remote or local Ollama LLM support
- Automatic tool call execution when needed
- Runs entirely in Docker via `docker compose`

---

## Prerequisites

- **Docker** & **Docker Compose v2**
- **Node.js 20+** (only inside the container if using Docker build)
- A valid **Trend Vision One API key**
- Access to an **Ollama** server (local or remote)

---

## Setup & Run

1. **Clone the repo**
   ```bash
   git clone https://github.com/your-org/vision-one-mcp-chat.git
   cd vision-one-mcp-chat
   ```

2. **Run the setup script**
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
   This will:
   - Prompt for your Vision One API key
   - Let you select the Vision One region
   - Ask for your Ollama base URL & model
   - Ask for the UI port
   - Save these to `.env`
   - Start all services with `docker compose up -d`

3. **Open the chat UI**
   - Go to [http://localhost:PORT](http://localhost:PORT) (replace `PORT` with your selection in setup)

---

## Environment Variables

These are auto-generated in `.env` by `start.sh`:

| Variable | Description | Example |
|----------|-------------|---------|
| `TREND_VISION_ONE_API_KEY` | Vision One API key | `abcd1234...` |
| `TREND_VISION_ONE_REGION` | Vision One region | `us`, `eu`, `jp`, `sg`, `in`, `au`, `mea` |
| `OLLAMA_BASE_URL` | Base URL of your Ollama server | `http://localhost:11434` |
| `OLLAMA_MODEL` | Ollama model name | `llama3:8b-instruct-q4_K_M` |
| `PORT` | Chat UI port | `8080` |

---

## Architecture

```
[Web UI] <-> [Chatbot Node App] <-> [MCP Client SDK] <-> (docker run vision-one-mcp-server)
                                                    \
                                                     \-> [Ollama Server (local/remote)]
```

- **Chatbot Node App**: Handles WebSocket chat, LLM planning, and MCP tool calls.
- **Vision One MCP Server**: Runs in Docker via stdio, exposes Vision One tools.
- **Ollama Server**: Provides LLM completions and planning.

---

## Supported MCP Tools

The Vision One MCP server provides multiple tools (depending on your license and permissions):

- `workbench_alerts_list`
- `crem_assets_list`
- `cam_assets_list`
- `container_security_clusters_list`
- `endpoint_security_agents_list`
- and more...

---

## Security Notes

- The MCP server is run with `-readonly=true` by default — this prevents write actions.
- Keep your `.env` file private; it contains your API key.
- The Docker socket is mounted for stdio-based container launches — do not expose this service to untrusted networks.

---

## References

- [Trend Micro Vision One MCP Server](https://github.com/trendmicro/vision-one-mcp-server)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Ollama Documentation](https://github.com/jmorganca/ollama)
