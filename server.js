import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import ollama from 'ollama';

const {
  TREND_VISION_ONE_API_KEY,
  TREND_VISION_ONE_REGION = 'us',
  OLLAMA_BASE_URL = 'http://localhost:11434',
  OLLAMA_MODEL = 'llama3.1:8b',
  PORT = 8080
} = process.env;

const app = express();
const server = app.listen(Number(PORT), () =>
  console.log(`Chat UI on http://localhost:${PORT}`)
);
const wss = new WebSocketServer({ server });

// Configure Ollama client (works even if remote is down; we’ll catch errors later)
const ollamaClient = ollama.create({ host: OLLAMA_BASE_URL });

/** Optional preflight: don’t crash; just record status for the UI */
function checkDockerAvailable() {
  try {
    execSync('docker version', { stdio: 'ignore' });
    execSync('test -S /var/run/docker.sock'); // ensure socket exists
    return true;
  } catch {
    return false;
  }
}

function checkEnv() {
  return Boolean(TREND_VISION_ONE_API_KEY && TREND_VISION_ONE_REGION);
}

let mcpClient = null;
let mcpTools = null;
let mcpTransport = null;
let mcpReady = false;
let mcpInitInProgress = false;

async function initMCPOnce() {
  if (mcpReady || mcpInitInProgress) return mcpReady;
  mcpInitInProgress = true;

  try {
    if (!checkEnv()) {
      console.warn('Vision One env not set; continuing without MCP.');
      mcpInitInProgress = false;
      return false;
    }
    if (!checkDockerAvailable()) {
      console.warn('Docker/socket not available inside container; continuing without MCP.');
      mcpInitInProgress = false;
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
    const tools = await client.listTools();

    mcpClient = client;
    mcpTools = tools?.tools || [];
    mcpTransport = transport;
    mcpReady = true;
    console.log('MCP connected. Tools:', mcpTools.map(t => t.name).join(', '));
    return true;
  } catch (e) {
    console.warn('MCP init failed (will keep running without MCP):', e?.message || e);
    try { await mcpTransport?.close?.(); } catch {}
    mcpClient = null;
    mcpTools = null;
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
ws.onopen = ()=> add('Connected. If MCP is not ready yet, it will initialize on first use.');
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

async function planAndAct(userText) {
  // Try to init MCP lazily
  await initMCPOnce();

  // Use LLM planner
  const sys = `You are a security assistant with MCP tools for Trend Vision One.
If MCP tools are available, decide if a tool should be called.
Return pure JSON: {"use_tool":true|false,"tool_name":"...","args":{}}`;

  let decision = { use_tool: false };
  try {
    const resp = await ollamaClient.chat({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: \`User: \${userText}\nAvailable tools: \${(mcpTools||[]).map(t=>t.name).join(', ')}\` }
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
      const text = call.content?.map(c => c.text || JSON.stringify(c)).join('\\n') || JSON.stringify(call, null, 2);
      return \`📎 \${decision.tool_name} →\\n\${text}\`;
    } catch (e) {
      return \`MCP tool call failed (\${decision.tool_name}). Verify API key/region and permissions.\`;
    }
  }

  // Fall back to plain answer
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
  'Ready. If MCP is unavailable, the chat still works and shows errors inline.',
  checkEnv() ? 'V1 env OK' : 'Missing TREND_VISION_ONE_API_KEY or region (set via start.sh)',
  checkDockerAvailable() ? 'Docker/socket OK' : 'Docker/socket not accessible inside container'
].join(' | ');

wss.on('connection', (ws) => {
  ws.send(banner);
  ws.on('message', async (data) => {
    const out = await planAndAct(data.toString());
    ws.send(out);
  });
});

// Don’t exit on SIGINT in container; Docker handles stop
process.on('SIGTERM', async () => {
  try { await mcpTransport?.close?.(); } finally { process.exit(0); }
});
