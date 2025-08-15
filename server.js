import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import ollama from 'ollama';

const {
  TREND_VISION_ONE_API_KEY,
  TREND_VISION_ONE_REGION = 'us',
  OLLAMA_BASE_URL = 'http://localhost:11434',
  OLLAMA_MODEL = 'llama3:8b-instruct-q4_K_M',
  PORT = 8080
} = process.env;

if (!TREND_VISION_ONE_API_KEY) {
  console.error('Missing TREND_VISION_ONE_API_KEY');
  process.exit(1);
}

const app = express();
const server = app.listen(Number(PORT), () =>
  console.log(`Chat on http://localhost:${PORT}`)
);
const wss = new WebSocketServer({ server });

// Remote Ollama server
const ollamaClient = ollama.create({ host: OLLAMA_BASE_URL });

function createMCPClient() {
  // Launch Trend Vision One MCP server via docker (stdio)
  const dockerCmd = 'docker';
  const dockerArgs = [
    'run', '-i', '--rm',
    '-e', 'TREND_VISION_ONE_API_KEY',
    'ghcr.io/trendmicro/vision-one-mcp-server',
    '-region', TREND_VISION_ONE_REGION,
    '-readonly=true'
  ];

  const transport = new StdioClientTransport({
    command: dockerCmd,
    args: dockerArgs,
    env: { TREND_VISION_ONE_API_KEY }
  });

  const client = new Client(
    { name: 'vision-one-mcp-chat', version: '1.0.0' },
    { capabilities: { experimental: { toolExecution: true } } },
    transport
  );

  return { client, transport };
}

const { client: mcp, transport } = createMCPClient();
await mcp.connect();
const tools = await mcp.listTools();

app.get('/', (_, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"/>
<title>Vision One MCP Chat</title>
<style>
body{font:14px/1.4 system-ui;padding:24px;max-width:860px;margin:auto}
#log{border:1px solid #ddd;padding:12px;height:460px;overflow:auto;border-radius:10px}
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
  <p><small>Tools: ${tools.tools.map(t=>t.name).join(', ')}</small></p>
  <div id="log"></div>
  <input id="msg" placeholder="Ask about Workbench alerts, CREM assets, containers, endpoints. Enter to send."/>
<script>
const ws = new WebSocket('ws://' + location.host + '/ws');
const log = document.getElementById('log');
const msg = document.getElementById('msg');
function add(text){const p=document.createElement('div');p.textContent=text;log.appendChild(p);log.scrollTop=log.scrollHeight;}
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
  const sys = `You are a security assistant with MCP tools for Trend Vision One.
Decide if a tool should be called to answer the question.
Return JSON only: {"use_tool":true|false,"tool_name":"...","args":{}}`;

  const resp = await ollamaClient.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `User: ${userText}\nAvailable tools: ${tools.tools.map(t=>t.name).join(', ')}` }
    ]
  });

  let decision = { use_tool: false };
  try {
    const match = resp.message.content.match(/\{[\s\S]*\}$/);
    if (match) decision = JSON.parse(match[0]);
  } catch {}

  if (decision.use_tool && decision.tool_name) {
    const call = await mcp.callTool({ name: decision.tool_name, arguments: decision.args || {} });
    const text = call.content?.map(c => c.text || JSON.stringify(c)).join('\n') || JSON.stringify(call, null, 2);
    return `📎 ${decision.tool_name} →\n${text}`;
  }

  const ans = await ollamaClient.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: 'Be concise and accurate about Trend Vision One topics.' },
      { role: 'user', content: userText }
    ]
  });
  return ans.message.content;
}

const banner = 'Connected to Vision One MCP. Ask about alerts, CREM, CAM, containers, endpoints.';
wss.on('connection', (ws) => {
  ws.send(banner);
  ws.on('message', async (data) => {
    try {
      const out = await planAndAct(data.toString());
      ws.send(out);
    } catch (e) {
      ws.send('Error: ' + (e?.message || e));
    }
  });
});

// Cleanup on exit
process.on('SIGINT', async () => {
  try { await transport.close?.(); } finally { process.exit(0); }
});
