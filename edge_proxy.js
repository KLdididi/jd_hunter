/**
 * edge_proxy.js - CDP 代理服务 (支持 WebSocket)
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const url = require('url');
const net = require('net');
const fs = require('fs');

const EDGE_PORT = 9222;
const PROXY_PORT = 9223;

let edgeProcess = null;

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // /launch - 启动 Edge
  if (parsedUrl.pathname === '/launch') {
    launchEdge();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'launching', message: 'Edge 正在启动...' }));
    return;
  }

  // /ws - WebSocket 代理
  if (parsedUrl.pathname === '/ws') {
    const target = parsedUrl.query.target;
    if (!target) {
      res.writeHead(400);
      res.end('Missing target parameter');
      return;
    }
    handleWebSocket(req, res, target);
    return;
  }

  // /proxy - 通用 HTTP 代理（用于绕过 CORS）
  if (parsedUrl.pathname === '/proxy') {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    const parsed = url.parse(targetUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      // JSON 响应直接返回
      if (proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('application/json')) {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(body);
        });
      } else {
        // 其他响应转发
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });

    proxyReq.end();
    return;
  }

  // CDP HTTP 代理
  if (parsedUrl.pathname.startsWith('/cdp/')) {
    const targetPath = parsedUrl.pathname.replace('/cdp/http', '') || '/json';
    const edgeUrl = `http://127.0.0.1:${EDGE_PORT}${targetPath}`;

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => forwardRequest(edgeUrl, 'POST', body, res, req.headers));
    } else {
      forwardRequest(edgeUrl, 'GET', null, res, req.headers);
    }
    return;
  }

  // 首页
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><title>Edge CDP Proxy</title></head><body>
    <h1>Edge CDP Proxy 运行中</h1>
    <p>代理端口: ${PROXY_PORT}</p>
    <p>Edge 端口: ${EDGE_PORT}</p>
    <p><a href="/cdp/http?path=/json/version">检查连接</a></p>
  </body></html>`);
});

// WebSocket 代理处理
function handleWebSocket(req, clientRes, targetUrl) {
  // 解析 target URL (ws://127.0.0.1:9222/devtools/page/xxx)
  const wsUrl = decodeURIComponent(targetUrl);
  const parsed = url.parse(wsUrl);
  
  const options = {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port || EDGE_PORT,
    path: parsed.path,
    method: 'GET',
    headers: {
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': req.headers['sec-websocket-key'] || '==',
      ...req.headers
    }
  };

  const proxy = http.request(options, (res) => {
    clientRes.writeHead(res.statusCode, res.headers);
  });

  proxy.on('upgrade', (req, socket, head) => {
    clientRes.writeHead(200, res.headers || { 'Upgrade': 'websocket', 'Connection': 'Upgrade' });
    socket.pipe(clientRes);
    clientRes.pipe(socket);
  });

  proxy.on('error', (e) => {
    console.error('WebSocket 代理错误:', e.message);
    clientRes.writeHead(502);
    clientRes.end('Proxy error');
  });

  req.pipe(proxy);

  // 也把目标服务器的响应转发回来
  const targetSocket = net.connect(parsed.port || EDGE_PORT, parsed.hostname || '127.0.0.1', () => {
    const { Writable } = require('stream');
    const targetReq = `GET ${parsed.path} HTTP/1.1\r\n`;
    const headers = Object.entries({
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': req.headers['sec-websocket-key'] || '==',
      'Host': `${parsed.hostname || '127.0.0.1'}:${parsed.port || EDGE_PORT}`
    }).map(([k,v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n';
    
    targetSocket.write(targetReq + headers);
    
    targetSocket.pipe(clientRes);
    clientRes.pipe(targetSocket);
  });
}

// 简单 TCP 代理处理 WebSocket
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/ws') {
    const target = decodeURIComponent(parsedUrl.query.target);
    const parsed = url.parse(target);
    
    const targetHost = parsed.hostname || '127.0.0.1';
    const targetPort = parsed.port || EDGE_PORT;
    const targetPath = parsed.path;

    // 发送升级请求到目标
    const reqStr = [
      `GET ${targetPath} HTTP/1.1`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Version: 13`,
      `Sec-WebSocket-Key: ${req.headers['sec-websocket-key'] || '=='}`,
      `Host: ${targetHost}:${targetPort}`,
      '',
      ''
    ].join('\r\n');

    const serverSocket = net.connect(targetPort, targetHost, () => {
      serverSocket.write(reqStr);
      
      // 双向 pipe
      socket.pipe(serverSocket);
      serverSocket.pipe(socket);
    });

    serverSocket.on('error', (e) => {
      console.error('WebSocket 连接失败:', e.message);
      socket.destroy();
    });

    socket.on('error', () => serverSocket.destroy());
  }
});

function forwardRequest(targetUrl, method, body, res, headers) {
  const parsed = url.parse(targetUrl);
  const options = {
    hostname: parsed.hostname || '127.0.0.1',
    port: parsed.port || 80,
    path: parsed.path,
    method: method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Edge CDP 不可用', message: e.message }));
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

function launchEdge() {
  if (edgeProcess) return;

  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ];

  let edgePath = edgePaths.find(p => {
    try { fs.accessSync(p); return true; } catch (e) { return false; }
  });

  if (!edgePath) {
    console.error('未找到浏览器');
    return;
  }

  console.log(`启动 ${edgePath}...`);
  edgeProcess = spawn(edgePath, [
    `--remote-debugging-port=${EDGE_PORT}`,
    '--user-data-dir=C:\\temp\\edge-debug'
  ], { detached: true, stdio: 'ignore' });
  edgeProcess.unref();
}

async function checkEdge() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${EDGE_PORT}/json/version`, (res) => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

server.listen(PROXY_PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Edge CDP Proxy 已启动`);
  console.log(`  代理端口: http://localhost:${PROXY_PORT}`);
  console.log(`  Edge 端口: ${EDGE_PORT}`);
  console.log(`========================================\n`);
  
  checkEdge().then(running => {
    if (running) console.log('✅ Edge 已在运行');
    else console.log('⚠️ Edge 未运行，请手动启动');
  });
});
