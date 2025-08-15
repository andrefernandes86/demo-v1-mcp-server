import express from 'express';
import { WebSocketServer } from 'ws';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import ollama from 'ollama';

// --- Env + hard defaults (you can override via .env)
const {
  TREND_VISION_ONE_API_KEY,
  TREND_VISION_ONE_REGION = 'us',
  OLLAMA_BASE_URL: OLLAMA_BASE_URL_ENV,
  OLLAMA_MODEL = 'llama3.1:8b',
  PORT = 8080
} = process.env;

// Force the Ollama host unless explicitly set in env
const OLLAMA_BASE_URL = OLLAMA_BASE_URL_ENV || 'http://192.168.1.100:11434';
process.env.OLLAMA_HOST = OLLAMA_BASE_URL; // some clients read this env

console.log(`Using Ollama at ${OLLAMA_BASE_URL} with model ${OLLAMA_MODEL}`);

const app = express();
const server = app.listen(Number(PORT), () =>
  console.log(`Chat UI on http://localhost:${PORT}`)
);
const wss = new WebSocketServer({ server });

// Dedicated Ollama client (never call the default export directly)
const ollamaClient = ollama.create({ host: OLLAMA_BASE_URL });

// Non-fatal preflight checks
function dockerAvailable() {
  try {
    execSync('docker version', { stdio: 'ignore' });
    execSync('test -S /var/run/docker.sock');
    return true;
  } catch {
    return false;
  }
}
function v1EnvOk() {
  return Boolean(TREND_VISION_ONE_API_KEY && TREND_VISION_ONE_REGION);
}

// Lazy MCP init state
let mcpClient = null;
let mcpTools = [];
let mcpTransport = null;
let mcpReady = false;
let mcpInitInProgress = false;

async function initMCPOnce() {
  if (mcpReady || mcpInitInProgress) return mcpReady;
  mcpInitInProgress = true;

  try {
    if (!v1EnvOk()) {
      console.warn('Vision One env not set; continuing without MCP.');
      return false;
    }
    if (!dockerAvailable()) {
      console.warn('Docker/socket not available in container; continuing without MCP.');
      return false;
    }

    const transport = new StdioClientTransport({
      command: 'docker',
      args: [
        'run', '-i', '--rm',
        '-e', 'TREND_VISION_ONE_API_KEY',
        'ghcr.io/trendmicro/vision-one-mcp-server',
        '-region', TREND_VISION_ONE_REGION,
        '-readonly=true'
      ],
      env: { TREND_VISION_ONE_API_KEY }
    });

    const client = new Client(
      { name: 'vision-one-mcp-chat', version: '1.0.0' },
      { capabilities: { experimental: { toolExecution: true } } },
      transport
    );

    await client.connect();
    const toolsResp = await client.listTools();

    mcpClient = client;
    mcpTools = toolsResp?.tools || [];
    mcpTransport = transport;
    mcpReady = true;
    console.log('MCP connected. Tools:', mcpTools.map(t => t.name).join(', '));
    return true;
  } catch (e) {
    console.warn('MCP init failed (will keep running without MCP):', e?.message || e);
    try { await mcpTransport?.close?.(); } catch {}
    mcpClient = null;
    mcpTools = [];
    mcpTransport = null;
    mcpReady = false;
    return false;
  } finally {
    mcpInitInProgress = false;
  }
}

app.get('/', (_, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"/>
<title>Vision One MCP Chat</title>
<style>
body{font:14px/1.4 system-ui;padding:24px;max-width:860px;margin:auto}
#log{border:1px solid #ddd;padding:12px;height:460px;overflow:auto;border-radius:10px;white-space:pre-wrap}
input{width:100%;padding:12px;margin-top:12px;border:1px solid #ccc;border-radius:10px}
small{color:#666}
.tag{display:inline-block;background:#f3f3f3;padding:2px 8px;border-radius:999px;margin-right:6px;font-size:12px}
</style></head>
<body>
  <h1>Vision One MCP Chat</h1>
  <p>
    <span class="tag">Region: ${TREND_VISION_ONE_REGION}</span>
    <span class="tag">Ollama: ${OLLAMA_BASE_URL}</span>
    <span class="tag">Model: ${OLLAMA_MODEL}</span>
  </p>
  <div id="log"></div>
  <input id="msg" placeholder="Ask about Workbench alerts, CREM, CAM, containers, endpoints. Enter to send."/>
<script>
const ws = new WebSocket('ws://' + location.host + '/ws');
const log = document.getElementById('log');
const msg = document.getElementById('msg');
function add(text){const p=document.createElement('div');p.textContent=text;log.appendChild(p);log.scrollTop=log.scrollHeight;}
ws.onopen = ()=> add('Connected. MCP will initialize on first use if available.');
ws.onmessage = e => add(e.data);
msg.addEventListener('keydown', e=>{
  if(e.key==='Enter' && msg.value.trim()){
    ws.send(msg.value.trim());
    add('You: ' + msg.value.trim());
    msg.value='';
  }
});
</script>
</body></html>`);
});

// Health check for Ollama reachability
app.get('/healthz', async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    res.status(200).send(`OK - Ollama reachable at ${OLLAMA_BASE_URL}`);
  } catch (e) {
    res.status(500).send(`ERR - cannot reach ${OLLAMA_BASE_URL} (${e?.code || e})`);
  }
});

async function planAndAct(userText) {
  // Lazy MCP init
  await initMCPOnce();

  // Planner
  const sys = `You are a security assistant with MCP tools for Trend Vision One.
If MCP tools are available, decide if a tool should be called.
Return pure JSON: {"use_tool":true|false,"tool_name":"...","args":{}}`;

  let decision = { use_tool: false };
  try {
    const resp = await ollamaClient.chat({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `User: ${userText}
Available tools: ${(mcpTools || []).map(t => t.name).join(', ')}` }
      ],
      options: { temperature: 0.2 }
    });
    const match = resp.message?.content?.match(/\{[\s\S]*\}$/);
    if (match) decision = JSON.parse(match[0]);
  } catch (e) {
    return 'LLM planner error. Check OLLAMA_BASE_URL and model reachability.';
  }

  if (decision.use_tool && decision.tool_name && mcpReady && mcpClient) {
    try {
      const call = await mcpClient.callTool({ name: decision.tool_name, arguments: decision.args || {} });
      const text = call.content?.map(c => c.text || JSON.stringify(c)).join('\n') || JSON.stringify(call, null, 2);
      return `📎 ${decision.tool_name} →\n${text}`;
    } catch {
      return `MCP tool call failed (${decision.tool_name}). Verify API key/region and permissions.`;
    }
  }

  // Fallback
  try {
    const ans = await ollamaClient.chat({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: 'Be concise and accurate about Trend Vision One topics.' },
        { role: 'user', content: userText }
      ],
      options: { temperature: 0.2 }
    });
    return ans.message?.content || 'No response from model.';
  } catch {
    return 'LLM call failed. Check OLLAMA_BASE_URL, network, and model availability.';
  }
}

const banner = [
  'Ready. If MCP is unavailable, chat still works and shows errors inline.',
  v1EnvOk() ? 'V1 env OK' : 'Missing TREND_VISION_ONE_API_KEY or region (run start.sh)',
  dockerAvailable() ? 'Docker/socket OK' : 'Docker/socket not accessible in container'
].join(' | ');

wss.on('connection', (ws) => {
  ws.send(banner);
  ws.on('message', async (data) => {
    const out = await planAndAct(data.toString());
    ws.send(out);
  });
});

process.on('SIGTERM', async () => {
  try { await mcpTransport?.close?.(); } finally { process.exit(0); }
});
