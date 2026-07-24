/**
 * Hugging Face 代理服务 - 增强版 v2.0
 * 支持: huggingface.co / hf.co / huggingface.space / Gradio Space API
 * 功能: 镜像加速、API代理、模型下载、Gradio Space 代理、前端界面
 */

const ALLOWED_ORIGINS = ['*'];

// 需要代理的目标域名
const TARGET_HOSTS = {
  'huggingface.co': true,
  'hf.co': true,
  'huggingface.space': true,
  'cdn.huggingface.co': true,
  'datasets-server.huggingface.co': true,
  'ui.endpoints.huggingface.co': true,
};

// Gradio Space 相关路径
const GRADIO_PATHS = [
  '/gradio_api/',
  '/config',
  '/theme.css',
  '/assets/',
  '/static/',
  '/file=',
  '/file/',
  '/upload',
  '/heartbeat',
  '/queue/',
  '/run/',
  '/predict',
  '/api/predict',
  '/reset',
  '/app_id',
  '/session',
  '/login',
  '/logout',
  '/token',
];

// 判断是否为 Gradio 相关请求
function isGradioRequest(pathname) {
  return GRADIO_PATHS.some(path => pathname.startsWith(path) || pathname === path);
}

// CORS 响应头
function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Auth-Token, X-CSRF-Token, Cache-Control, X-Api-Key, X-Api-Secret, X-Gradio-Event-Id, X-Gradio-Request-Id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-Request-Id, X-Cache-Status, X-Cache-Hits, X-Gradio-Event-Id, X-Gradio-Request-Id',
  };
}

// 构建目标 URL
function buildTargetUrl(url, targetHost, pathname) {
  const urlObj = new URL(url);
  urlObj.hostname = targetHost;
  urlObj.protocol = 'https';
  if (pathname) urlObj.pathname = pathname;
  return urlObj.toString();
}

// 判断是否为 API 请求
function isApiRequest(pathname) {
  return pathname.startsWith('/api/') || 
         pathname.startsWith('/models/') || 
         pathname.startsWith('/datasets/') || 
         pathname.startsWith('/spaces/') ||
         pathname.startsWith('/resolve/') || 
         pathname.startsWith('/raw/') || 
         pathname.startsWith('/blob/') ||
         pathname.startsWith('/pipeline/') ||
         pathname.startsWith('/feature-extraction/') ||
         pathname.startsWith('/token-classification/') ||
         pathname.startsWith('/question-answering/') ||
         pathname.startsWith('/translation/') ||
         pathname.startsWith('/summarization/') ||
         pathname.startsWith('/text-generation/') ||
         pathname.startsWith('/text2text-generation/') ||
         pathname.startsWith('/fill-mask/') ||
         pathname.startsWith('/sentence-similarity/') ||
         pathname.startsWith('/zero-shot-classification/') ||
         pathname.startsWith('/image-classification/') ||
         pathname.startsWith('/automatic-speech-recognition/') ||
         pathname.startsWith('/audio-classification/') ||
         pathname.startsWith('/object-detection/') ||
         pathname.startsWith('/image-segmentation/');
}

// 解析 Space 路径: /spaces/username/space-name/... -> { user, space, restPath }
function parseSpacePath(pathname) {
  const match = pathname.match(/^\/spaces\/([^\/]+)\/([^\/]+)(.*)$/);
  if (!match) return null;
  return {
    user: match[1],
    space: match[2],
    restPath: match[3] || '',
  };
}

// 获取 Space 的子域名: username-space-name.hf.space
function getSpaceSubdomain(user, space) {
  return `${user}-${space}.hf.space`;
}

// 重写响应中的 URL
function rewriteUrls(text, proxyHost, targetSubdomain, spacePath) {
  if (!text || typeof text !== 'string') return text;

  // 重写 hf.space 子域名链接 -> 代理路径
  const hfSpacePattern = new RegExp(
    `https?://${targetSubdomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 
    'g'
  );
  text = text.replace(hfSpacePattern, `https://${proxyHost}/spaces${spacePath}`);

  // 重写 huggingface.co/spaces 链接
  text = text.replace(
    /https?:\/\/huggingface\.co\/spaces\//g, 
    `https://${proxyHost}/spaces/`
  );

  // 重写绝对路径的 API 调用
  text = text.replace(
    new RegExp(`(["'\s])\/gradio_api\/`, 'g'),
    `$1/spaces${spacePath}/gradio_api/`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/config(["'\s])`, 'g'),
    `$1/spaces${spacePath}/config$2`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/assets\/`, 'g'),
    `$1/spaces${spacePath}/assets/`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/file=`, 'g'),
    `$1/spaces${spacePath}/file=`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/queue\/`, 'g'),
    `$1/spaces${spacePath}/queue/`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/run\/`, 'g'),
    `$1/spaces${spacePath}/run/`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/predict(["'\s])`, 'g'),
    `$1/spaces${spacePath}/predict$2`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/heartbeat(["'\s])`, 'g'),
    `$1/spaces${spacePath}/heartbeat$2`
  );

  text = text.replace(
    new RegExp(`(["'\s])\/upload(["'\s])`, 'g'),
    `$1/spaces${spacePath}/upload$2`
  );

  return text;
}

// 创建代理请求头
function createProxyHeaders(request, targetHost, proxyHost) {
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set('Host', targetHost);
  proxyHeaders.delete('Referer');
  proxyHeaders.set('Referer', `https://${targetHost}/`);

  // 移除 Cloudflare 相关头
  proxyHeaders.delete('CF-Connecting-IP');
  proxyHeaders.delete('CF-Visitor');
  proxyHeaders.delete('CF-Ray');
  proxyHeaders.delete('CF-Worker');

  // 设置 Origin
  proxyHeaders.set('Origin', `https://${targetHost}`);

  return proxyHeaders;
}

// 代理 HTTP 请求
async function proxyHttpRequest(request, targetUrl, targetHost, proxyHost, spaceInfo) {
  const proxyHeaders = createProxyHeaders(request, targetHost, proxyHost);
  const origin = request.headers.get('Origin') || '*';

  try {
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'follow',
    });

    const response = await fetch(proxyRequest);

    // 构建响应头
    const responseHeaders = new Headers(response.headers);
    const corsHeaders = getCorsHeaders(origin);

    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });

    // 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = responseHeaders.get('Location');
      if (location) {
        try {
          const locUrl = new URL(location);
          if (TARGET_HOSTS[locUrl.hostname] || locUrl.hostname.endsWith('.hf.space')) {
            if (locUrl.hostname.endsWith('.hf.space')) {
              const parts = locUrl.hostname.replace('.hf.space', '').split('-');
              if (parts.length >= 2 && spaceInfo) {
                locUrl.pathname = `/spaces/${spaceInfo.user}/${spaceInfo.space}${locUrl.pathname}`;
              }
            }
            locUrl.hostname = proxyHost;
            locUrl.protocol = 'https';
            responseHeaders.set('Location', locUrl.toString());
          }
        } catch (e) {
          // 相对路径或无效 URL，保持原样
        }
      }
    }

    // 删除安全限制头
    responseHeaders.delete('Content-Security-Policy');
    responseHeaders.delete('X-Frame-Options');

    // 判断是否需要重写内容
    const contentType = responseHeaders.get('Content-Type') || '';
    const isText = contentType.includes('text/') || 
                   contentType.includes('application/javascript') ||
                   contentType.includes('application/json') ||
                   contentType.includes('application/xml');

    // 如果是 Space 相关的文本内容，进行 URL 重写
    if (spaceInfo && isText && !targetUrl.includes('/gradio_api/call/')) {
      const text = await response.text();
      const targetSubdomain = getSpaceSubdomain(spaceInfo.user, spaceInfo.space);
      const spacePath = `/${spaceInfo.user}/${spaceInfo.space}`;
      const rewritten = rewriteUrls(text, proxyHost, targetSubdomain, spacePath);

      responseHeaders.delete('Content-Length');

      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // 流式响应（SSE、文件下载等）
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return jsonResponse({
      error: 'Proxy Error',
      message: error.message,
      timestamp: new Date().toISOString(),
    }, 502);
  }
}

// 代理 WebSocket 请求
async function proxyWebSocket(request, targetWsUrl, proxyHost) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  try {
    const [clientSocket, serverSocket] = Object.values(new WebSocketPair());
    const targetWs = new WebSocket(targetWsUrl);

    targetWs.addEventListener('open', () => {
      console.log('WebSocket connected to target');
    });

    serverSocket.addEventListener('message', (event) => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(event.data);
      }
    });

    targetWs.addEventListener('message', (event) => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.send(event.data);
      }
    });

    serverSocket.addEventListener('close', () => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.close();
      }
    });

    targetWs.addEventListener('close', () => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close();
      }
    });

    targetWs.addEventListener('error', (error) => {
      console.error('Target WebSocket error:', error);
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close();
      }
    });

    serverSocket.accept();

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });

  } catch (error) {
    console.error('WebSocket proxy error:', error);
    return jsonResponse({
      error: 'WebSocket Proxy Error',
      message: error.message,
    }, 502);
  }
}

// 主处理函数
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const proxyHost = url.hostname;
  const origin = request.headers.get('Origin') || '*';

  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }

  // 根路径返回前端界面
  if (pathname === '/' || pathname === '/index.html') {
    return serveFrontend(url.origin);
  }

  // 静态资源
  if (pathname.startsWith('/static/')) {
    return serveStatic(pathname);
  }

  // 健康检查
  if (pathname === '/health') {
    return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
  }

  // API 信息
  if (pathname === '/api/info') {
    return jsonResponse({
      name: 'Hugging Face Proxy',
      version: '2.0.0',
      endpoints: {
        models: '/models/*',
        datasets: '/datasets/*',
        spaces: '/spaces/<user>/<space>/*',
        gradio_api: '/spaces/<user>/<space>/gradio_api/*',
        api: '/api/*',
        inference: '/pipeline/*',
      },
      supportedHosts: Object.keys(TARGET_HOSTS),
      features: [
        'Model/Dataset download',
        'Inference API',
        'Gradio Space proxy',
        'WebSocket support',
        'SSE streaming',
        'URL rewriting',
      ],
    });
  }

  // === Gradio Space 代理 ===
  const spaceInfo = parseSpacePath(pathname);

  if (spaceInfo) {
    const { user, space, restPath } = spaceInfo;
    const spaceSubdomain = getSpaceSubdomain(user, space);

    // 检查是否为 WebSocket 升级请求
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      const targetWsUrl = `wss://${spaceSubdomain}${restPath}${url.search}`;
      return proxyWebSocket(request, targetWsUrl, proxyHost);
    }

    // 判断请求类型
    if (isGradioRequest(restPath) || restPath === '' || restPath === '/') {
      // Gradio API 或 Space 页面请求 -> 代理到 hf.space 子域名
      const targetUrl = buildTargetUrl(request.url, spaceSubdomain, restPath);
      return proxyHttpRequest(request, targetUrl, spaceSubdomain, proxyHost, spaceInfo);
    } else {
      // Space 页面资源 -> 代理到 huggingface.co
      const targetUrl = buildTargetUrl(request.url, 'huggingface.co');
      return proxyHttpRequest(request, targetUrl, 'huggingface.co', proxyHost, spaceInfo);
    }
  }

  // === 标准 Hugging Face 代理 ===
  let targetHost = 'huggingface.co';

  if (pathname.startsWith('/datasets/')) {
    targetHost = 'huggingface.co';
  } else if (pathname.startsWith('/api/datasets/')) {
    targetHost = 'datasets-server.huggingface.co';
  }

  const targetUrl = buildTargetUrl(request.url, targetHost);
  return proxyHttpRequest(request, targetUrl, targetHost, proxyHost, null);
}

// 返回 JSON 响应
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders('*'),
    },
  });
}

// 提供前端界面
function serveFrontend(domain) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hugging Face 代理</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0f172a; --bg-card: #1e293b; --bg-hover: #334155;
      --text: #f1f5f9; --text-muted: #94a3b8;
      --accent: #f59e0b; --accent-light: #fbbf24;
      --border: #334155; --success: #10b981; --error: #ef4444;
      --gradio: #ff6b6b;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--text);
      min-height: 100vh; line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { text-align: center; padding: 3rem 0; border-bottom: 1px solid var(--border); margin-bottom: 2rem; }
    .logo { font-size: 3rem; margin-bottom: 0.5rem; }
    h1 {
      font-size: 2.5rem;
      background: linear-gradient(135deg, var(--accent), var(--accent-light));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    .subtitle { color: var(--text-muted); font-size: 1.1rem; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: var(--bg-card); padding: 0.5rem 1rem;
      border-radius: 2rem; margin-top: 1rem; font-size: 0.9rem;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 1rem; padding: 2rem; margin-bottom: 2rem; }
    .card h2 { font-size: 1.5rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .input-group { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    input[type="text"], select {
      flex: 1; padding: 0.75rem 1rem; background: var(--bg); border: 1px solid var(--border);
      border-radius: 0.5rem; color: var(--text); font-size: 1rem; outline: none; transition: border-color 0.2s;
    }
    input[type="text"]:focus, select:focus { border-color: var(--accent); }
    button {
      padding: 0.75rem 1.5rem; background: linear-gradient(135deg, var(--accent), #d97706);
      color: white; border: none; border-radius: 0.5rem; font-size: 1rem;
      font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3); }
    button:active { transform: translateY(0); }
    button.secondary { background: var(--bg-hover); }
    button.secondary:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    button.gradio { background: linear-gradient(135deg, var(--gradio), #ee5a5a); }
    button.gradio:hover { box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3); }
    .url-display {
      background: var(--bg); padding: 1rem; border-radius: 0.5rem;
      font-family: 'Courier New', monospace; font-size: 0.9rem;
      word-break: break-all; border: 1px solid var(--border); margin-bottom: 1rem; position: relative;
    }
    .copy-btn { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); padding: 0.25rem 0.75rem; font-size: 0.8rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
    .feature-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 1rem;
      padding: 1.5rem; transition: transform 0.2s, border-color 0.2s;
    }
    .feature-card:hover { transform: translateY(-4px); border-color: var(--accent); }
    .feature-icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .feature-card h3 { margin-bottom: 0.5rem; color: var(--accent-light); }
    .feature-card p { color: var(--text-muted); font-size: 0.95rem; }
    .code-block {
      background: #0d1117; border: 1px solid #30363d; border-radius: 0.5rem;
      padding: 1rem; overflow-x: auto; font-family: 'Courier New', monospace;
      font-size: 0.85rem; line-height: 1.5; margin: 1rem 0;
    }
    .code-block .comment { color: #8b949e; }
    .code-block .string { color: #a5d6ff; }
    .code-block .keyword { color: #ff7b72; }
    .code-block .function { color: #d2a8ff; }
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; flex-wrap: wrap; }
    .tab { padding: 0.5rem 1rem; background: none; border: none; color: var(--text-muted); cursor: pointer; border-radius: 0.25rem; font-size: 0.9rem; }
    .tab.active { background: var(--bg-hover); color: var(--text); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    footer { text-align: center; padding: 2rem; color: var(--text-muted); border-top: 1px solid var(--border); margin-top: 2rem; }
    .toast {
      position: fixed; bottom: 2rem; right: 2rem; background: var(--success); color: white;
      padding: 1rem 1.5rem; border-radius: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transform: translateY(100px); opacity: 0; transition: all 0.3s; z-index: 1000;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.8rem; font-weight: 600; margin-left: 0.5rem; }
    .badge-new { background: var(--gradio); color: white; }
    @media (max-width: 768px) {
      .container { padding: 1rem; }
      h1 { font-size: 1.8rem; }
      .input-group { flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
      .tabs { overflow-x: auto; flex-wrap: nowrap; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">🤗</div>
      <h1>Hugging Face 代理</h1>
      <p class="subtitle">加速访问 Hugging Face 模型、数据集、Spaces 和 Gradio API</p>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span id="statusText">服务运行中</span>
      </div>
    </header>

    <div class="card">
      <h2>🔗 快速访问</h2>
      <div class="input-group">
        <select id="resourceType">
          <option value="models">模型 (models)</option>
          <option value="datasets">数据集 (datasets)</option>
          <option value="spaces">Spaces</option>
        </select>
        <input type="text" id="resourcePath" placeholder="例如: bert-base-chinese 或 microsoft/DialoGPT-medium">
      </div>
      <div class="input-group">
        <button onclick="goToResource()">🚀 访问</button>
        <button class="secondary" onclick="copyUrl()">📋 复制链接</button>
      </div>
      <div class="url-display" id="urlDisplay">
        <span id="generatedUrl">${domain}/models/bert-base-chinese</span>
        <button class="copy-btn secondary" onclick="copyGeneratedUrl()">复制</button>
      </div>
    </div>

    <div class="card">
      <h2>🎨 Gradio Space 代理 <span class="badge badge-new">NEW</span></h2>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">
        直接通过代理访问 Gradio Space，支持 WebSocket、SSE 流式传输和 API 调用。
      </p>
      <div class="input-group">
        <input type="text" id="spacePath" placeholder="username/space-name" style="flex: 1;">
        <button class="gradio" onclick="goToSpace()">🚀 访问 Space</button>
      </div>
      <div class="url-display">
        <span id="spaceUrl">${domain}/spaces/username/space-name</span>
        <button class="copy-btn secondary" onclick="copySpaceUrl()">复制</button>
      </div>
      <div style="margin-top: 1rem;">
        <h3 style="font-size: 1rem; margin-bottom: 0.5rem;">支持的 Gradio API 端点：</h3>
        <div class="code-block">
/spaces/&lt;user&gt;/&lt;space&gt;/gradio_api/openapi.json    <span class="comment"># OpenAPI 规范</span>
/spaces/&lt;user&gt;/&lt;space&gt;/gradio_api/info              <span class="comment"># API 信息</span>
/spaces/&lt;user&gt;/&lt;space&gt;/gradio_api/call/&lt;api&gt;      <span class="comment"># 提交预测</span>
/spaces/&lt;user&gt;/&lt;space&gt;/gradio_api/call/&lt;api&gt;/&lt;id&gt; <span class="comment"># 获取结果 (SSE)</span>
/spaces/&lt;user&gt;/&lt;space&gt;/config                       <span class="comment"># Gradio 配置</span>
/spaces/&lt;user&gt;/&lt;space&gt;/queue/join                   <span class="comment"># 队列 (WebSocket)</span>
/spaces/&lt;user&gt;/&lt;space&gt;/file/&lt;path&gt;                 <span class="comment"># 文件访问</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>💻 使用示例</h2>
      <div class="tabs">
        <button class="tab active" onclick="switchTab('python')">Python</button>
        <button class="tab" onclick="switchTab('curl')">cURL</button>
        <button class="tab" onclick="switchTab('js')">JavaScript</button>
        <button class="tab" onclick="switchTab('git')">Git</button>
        <button class="tab" onclick="switchTab('gradio')">Gradio Client</button>
      </div>

      <div id="python" class="tab-content active">
        <div class="code-block">
<span class="comment"># 使用 transformers 库</span>
<span class="keyword">from</span> transformers <span class="keyword">import</span> AutoModel, AutoTokenizer

<span class="comment"># 设置代理 endpoint</span>
endpoint = <span class="string">"${domain}"</span>

<span class="comment"># 下载模型（通过代理）</span>
model = AutoModel.from_pretrained(
    <span class="string">"bert-base-chinese"</span>,
    cache_dir=<span class="string">"./cache"</span>
)

<span class="comment"># 使用 huggingface_hub</span>
<span class="keyword">from</span> huggingface_hub <span class="keyword">import</span> hf_hub_download
<span class="keyword">import</span> os
os.environ[<span class="string">"HF_ENDPOINT"</span>] = <span class="string">"${domain}"</span>

file_path = hf_hub_download(
    repo_id=<span class="string">"bert-base-chinese"</span>,
    filename=<span class="string">"config.json"</span>
)
        </div>
      </div>

      <div id="curl" class="tab-content">
        <div class="code-block">
<span class="comment"># 下载模型文件</span>
curl -L <span class="string">"${domain}/bert-base-chinese/resolve/main/config.json"</span>

<span class="comment"># 调用 Inference API</span>
curl -X POST <span class="string">"${domain}/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{"inputs": "Hello world"}'</span>

<span class="comment"># 调用 Gradio Space API</span>
curl -X POST <span class="string">"${domain}/spaces/username/space-name/gradio_api/call/predict"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{"data": ["Hello"]}'</span>
        </div>
      </div>

      <div id="js" class="tab-content">
        <div class="code-block">
<span class="comment">// 调用推理 API</span>
<span class="keyword">const</span> response = <span class="keyword">await</span> <span class="function">fetch</span>(<span class="string">'${domain}/pipeline/sentiment-analysis/distilbert-base-uncased-finetuned-sst-2-english'</span>, {
  method: <span class="string">'POST'</span>,
  headers: { <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span> },
  body: <span class="string">JSON.stringify({ inputs: "I love this product!" })</span>
});

<span class="keyword">const</span> result = <span class="keyword">await</span> response.<span class="function">json</span>();
console.<span class="function">log</span>(result);

<span class="comment">// 调用 Gradio Space API</span>
<span class="keyword">const</span> app = <span class="keyword">await</span> <span class="function">fetch</span>(<span class="string">'${domain}/spaces/username/space-name/gradio_api/call/predict'</span>, {
  method: <span class="string">'POST'</span>,
  headers: { <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span> },
  body: <span class="string">JSON.stringify({ data: ["Hello"] })</span>
});
        </div>
      </div>

      <div id="git" class="tab-content">
        <div class="code-block">
<span class="comment"># 克隆模型仓库（使用代理）</span>
git clone ${domain}/bert-base-chinese

<span class="comment"># 使用 huggingface-cli</span>
<span class="keyword">export</span> HF_ENDPOINT=${domain}
huggingface-cli download bert-base-chinese

<span class="comment"># 下载特定文件</span>
huggingface-cli download bert-base-chinese config.json pytorch_model.bin
        </div>
      </div>

      <div id="gradio" class="tab-content">
        <div class="code-block">
<span class="comment"># 使用 Gradio Python Client 通过代理访问 Space</span>
<span class="keyword">from</span> gradio_client <span class="keyword">import</span> Client

<span class="comment"># 设置代理环境变量</span>
<span class="keyword">import</span> os
os.environ[<span class="string">"HF_ENDPOINT"</span>] = <span class="string">"${domain}"</span>

<span class="comment"># 连接到 Space（通过代理）</span>
client = Client(<span class="string">"username/space-name"</span>)

<span class="comment"># 调用 API</span>
result = client.predict(<span class="string">"Hello, world!"</span>, api_name=<span class="string">"/predict"</span>)
print(result)

<span class="comment"># 流式输出</span>
job = client.submit(<span class="string">"Hello"</span>, api_name=<span class="string">"/predict"</span>)
<span class="keyword">for</span> output <span class="keyword">in</span> job:
    print(output)
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3>加速下载</h3>
        <p>通过 Cloudflare 全球 CDN 网络加速模型和数据集下载，解决国内访问慢的问题。</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">🔧</div>
        <h3>API 代理</h3>
        <p>完整支持 Hugging Face Inference API，可直接调用模型进行推理。</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">🎨</div>
        <h3>Gradio Space 代理 <span class="badge badge-new">NEW</span></h3>
        <p>支持代理 Gradio Space 的完整功能，包括 WebSocket、SSE 流式传输和文件上传。</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">📦</div>
        <h3>模型下载</h3>
        <p>支持 transformers、huggingface_hub、git-lfs 等多种下载方式。</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">🔒</div>
        <h3>安全可靠</h3>
        <p>纯代理转发，不存储任何数据。支持 HTTPS 加密传输。</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">🌐</div>
        <h3>CORS 支持</h3>
        <p>完整的跨域支持，可直接在浏览器前端调用 API。</p>
      </div>
    </div>

    <div class="card">
      <h2>📚 支持的端点</h2>
      <div class="code-block">
/models/&lt;model-id&gt;                              <span class="comment"># 模型页面</span>
/datasets/&lt;dataset-id&gt;                          <span class="comment"># 数据集页面</span>
/spaces/&lt;space-id&gt;                              <span class="comment"># Spaces 页面</span>
/spaces/&lt;user&gt;/&lt;space&gt;/gradio_api/*            <span class="comment"># Gradio API</span>
/spaces/&lt;user&gt;/&lt;space&gt;/config                   <span class="comment"># Gradio 配置</span>
/spaces/&lt;user&gt;/&lt;space&gt;/queue/*                 <span class="comment"># 队列 (WebSocket)</span>
/api/models/&lt;model-id&gt;                          <span class="comment"># 模型 API</span>
/api/datasets/&lt;dataset-id&gt;                      <span class="comment"># 数据集 API</span>
/&lt;model-id&gt;/resolve/main/&lt;file&gt;                <span class="comment"># 下载文件</span>
/&lt;model-id&gt;/blob/main/&lt;file&gt;                   <span class="comment"># 查看文件</span>
/pipeline/&lt;task&gt;/&lt;model-id&gt;                  <span class="comment"># 推理 API</span>
      </div>
    </div>
  </div>

  <footer>
    <p>Made with ❤️ | 基于 Cloudflare Workers 构建</p>
    <p style="margin-top: 0.5rem; font-size: 0.9rem;">此服务仅供学习和研究使用</p>
  </footer>

  <div class="toast" id="toast">已复制到剪贴板！</div>

  <script>
    const domain = window.location.origin;

    function updateUrl() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim() || 'bert-base-chinese';
      const url = \`\${domain}/\${type}/\${path}\`;
      document.getElementById('generatedUrl').textContent = url;
    }

    function updateSpaceUrl() {
      const path = document.getElementById('spacePath').value.trim() || 'username/space-name';
      const url = \`\${domain}/spaces/\${path}\`;
      document.getElementById('spaceUrl').textContent = url;
    }

    function goToResource() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim();
      if (!path) { showToast('请输入资源路径'); return; }
      window.open(\`\${domain}/\${type}/\${path}\`, '_blank');
    }

    function goToSpace() {
      const path = document.getElementById('spacePath').value.trim();
      if (!path) { showToast('请输入 Space 路径'); return; }
      window.open(\`\${domain}/spaces/\${path}\`, '_blank');
    }

    function copyUrl() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim() || 'bert-base-chinese';
      navigator.clipboard.writeText(\`\${domain}/\${type}/\${path}\`);
      showToast('链接已复制！');
    }

    function copySpaceUrl() {
      const path = document.getElementById('spacePath').value.trim() || 'username/space-name';
      navigator.clipboard.writeText(\`\${domain}/spaces/\${path}\`);
      showToast('Space 链接已复制！');
    }

    function copyGeneratedUrl() {
      const url = document.getElementById('generatedUrl').textContent;
      navigator.clipboard.writeText(url);
      showToast('链接已复制！');
    }

    function showToast(message) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabName).classList.add('active');
    }

    document.getElementById('resourceType').addEventListener('change', updateUrl);
    document.getElementById('resourcePath').addEventListener('input', updateUrl);
    document.getElementById('spacePath').addEventListener('input', updateSpaceUrl);

    fetch('/health')
      .then(r => r.json())
      .then(() => { document.getElementById('statusText').textContent = '服务运行中'; })
      .catch(() => {
        document.getElementById('statusText').textContent = '服务异常';
        document.querySelector('.status-dot').style.background = 'var(--error)';
      });

    updateUrl();
    updateSpaceUrl();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      ...getCorsHeaders('*'),
    },
  });
}

// 提供静态资源
async function serveStatic(pathname) {
  return new Response('Not Found', { status: 404 });
}

// Cloudflare Workers 入口
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};
