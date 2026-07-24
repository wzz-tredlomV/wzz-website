/**
 * Hugging Face 代理服务
 * 支持: huggingface.co / hf.co / huggingface.space
 * 功能: 镜像加速、API代理、模型下载、前端界面
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

// 需要特殊处理的路径
const API_PATHS = [
  '/api/',
  '/models/',
  '/datasets/',
  '/spaces/',
  '/resolve/',
  '/raw/',
  '/blob/',
  '/info/',
  '/pipeline/',
  '/feature-extraction/',
  '/token-classification/',
  '/question-answering/',
  '/translation/',
  '/summarization/',
  '/text-generation/',
  '/text2text-generation/',
  '/fill-mask/',
  '/sentence-similarity/',
  '/zero-shot-classification/',
  '/image-classification/',
  '/automatic-speech-recognition/',
  '/audio-classification/',
  '/object-detection/',
  '/image-segmentation/',
];

// CORS 响应头
function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Auth-Token, X-CSRF-Token, Cache-Control, X-Api-Key, X-Api-Secret',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-Request-Id, X-Cache-Status, X-Cache-Hits',
  };
}

// 构建目标 URL
function buildTargetUrl(url, targetHost) {
  const urlObj = new URL(url);
  urlObj.hostname = targetHost;
  urlObj.protocol = 'https';
  return urlObj.toString();
}

// 判断是否为 API 请求
function isApiRequest(pathname) {
  return API_PATHS.some(path => pathname.startsWith(path));
}

// 主处理函数
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
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
      version: '1.0.0',
      endpoints: {
        models: '/models/*',
        datasets: '/datasets/*',
        spaces: '/spaces/*',
        api: '/api/*',
        inference: '/pipeline/*',
      },
      supportedHosts: Object.keys(TARGET_HOSTS),
    });
  }

  // 确定目标主机
  let targetHost = 'huggingface.co';
  
  // 检查是否是直接的模型/数据集请求
  if (pathname.startsWith('/datasets/')) {
    targetHost = 'huggingface.co';
  } else if (pathname.startsWith('/spaces/')) {
    targetHost = 'huggingface.co';
  } else if (pathname.startsWith('/api/datasets/')) {
    targetHost = 'datasets-server.huggingface.co';
  }

  // 构建目标 URL
  const targetUrl = buildTargetUrl(request.url, targetHost);

  // 创建代理请求
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set('Host', targetHost);
  proxyHeaders.delete('Referer');
  proxyHeaders.set('Referer', `https://${targetHost}/`);
  
  // 移除 Cloudflare 相关头
  proxyHeaders.delete('CF-Connecting-IP');
  proxyHeaders.delete('CF-Visitor');
  proxyHeaders.delete('CF-Ray');
  proxyHeaders.delete('CF-Worker');

  try {
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'follow',
    });

    const response = await fetch(proxyRequest);
    
    // 构建响应
    const responseHeaders = new Headers(response.headers);
    const corsHeaders = getCorsHeaders(origin);
    
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });

    // 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = responseHeaders.get('Location');
      if (location) {
        // 将重定向地址也代理化
        try {
          const locUrl = new URL(location);
          if (TARGET_HOSTS[locUrl.hostname]) {
            locUrl.hostname = url.hostname;
            locUrl.protocol = url.protocol;
            responseHeaders.set('Location', locUrl.toString());
          }
        } catch (e) {
          // 相对路径或无效 URL，保持原样
        }
      }
    }

    // 修改 Content-Security-Policy 允许加载
    responseHeaders.delete('Content-Security-Policy');
    responseHeaders.delete('X-Frame-Options');

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
      --bg: #0f172a;
      --bg-card: #1e293b;
      --bg-hover: #334155;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #f59e0b;
      --accent-light: #fbbf24;
      --border: #334155;
      --success: #10b981;
      --error: #ef4444;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    header {
      text-align: center;
      padding: 3rem 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 2rem;
    }
    
    .logo {
      font-size: 3rem;
      margin-bottom: 0.5rem;
    }
    
    h1 {
      font-size: 2.5rem;
      background: linear-gradient(135deg, var(--accent), var(--accent-light));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    
    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
    }
    
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--bg-card);
      padding: 0.5rem 1rem;
      border-radius: 2rem;
      margin-top: 1rem;
      font-size: 0.9rem;
    }
    
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 2rem;
      margin-bottom: 2rem;
    }
    
    .card h2 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .input-group {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    
    input[type="text"], select {
      flex: 1;
      padding: 0.75rem 1rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      color: var(--text);
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
    }
    
    input[type="text"]:focus, select:focus {
      border-color: var(--accent);
    }
    
    button {
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, var(--accent), #d97706);
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
    }
    
    button:active {
      transform: translateY(0);
    }
    
    button.secondary {
      background: var(--bg-hover);
    }
    
    button.secondary:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    
    .url-display {
      background: var(--bg);
      padding: 1rem;
      border-radius: 0.5rem;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      word-break: break-all;
      border: 1px solid var(--border);
      margin-bottom: 1rem;
      position: relative;
    }
    
    .copy-btn {
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      padding: 0.25rem 0.75rem;
      font-size: 0.8rem;
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    
    .feature-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
      transition: transform 0.2s, border-color 0.2s;
    }
    
    .feature-card:hover {
      transform: translateY(-4px);
      border-color: var(--accent);
    }
    
    .feature-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }
    
    .feature-card h3 {
      margin-bottom: 0.5rem;
      color: var(--accent-light);
    }
    
    .feature-card p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    
    .code-block {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 0.5rem;
      padding: 1rem;
      overflow-x: auto;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
      line-height: 1.5;
      margin: 1rem 0;
    }
    
    .code-block .comment { color: #8b949e; }
    .code-block .string { color: #a5d6ff; }
    .code-block .keyword { color: #ff7b72; }
    .code-block .function { color: #d2a8ff; }
    
    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
    }
    
    .tab {
      padding: 0.5rem 1rem;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 0.25rem;
      font-size: 0.9rem;
    }
    
    .tab.active {
      background: var(--bg-hover);
      color: var(--text);
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }
    
    footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      margin-top: 2rem;
    }
    
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: var(--success);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
      z-index: 1000;
    }
    
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    
    @media (max-width: 768px) {
      .container { padding: 1rem; }
      h1 { font-size: 1.8rem; }
      .input-group { flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">🤗</div>
      <h1>Hugging Face 代理</h1>
      <p class="subtitle">加速访问 Hugging Face 模型、数据集和 Spaces</p>
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
      <h2>💻 使用示例</h2>
      <div class="tabs">
        <button class="tab active" onclick="switchTab('python')">Python</button>
        <button class="tab" onclick="switchTab('curl')">cURL</button>
        <button class="tab" onclick="switchTab('js')">JavaScript</button>
        <button class="tab" onclick="switchTab('git')">Git</button>
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

<span class="comment"># 或者直接使用 huggingface_hub</span>
<span class="keyword">from</span> huggingface_hub <span class="keyword">import</span> hf_hub_download

<span class="comment"># 设置环境变量</span>
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

<span class="comment"># 获取模型信息</span>
curl <span class="string">"${domain}/api/models/bert-base-chinese"</span>
        </div>
      </div>
      
      <div id="js" class="tab-content">
        <div class="code-block">
<span class="comment">// 使用 fetch API 调用推理服务</span>
<span class="keyword">const</span> response = <span class="keyword">await</span> <span class="function">fetch</span>(<span class="string">'${domain}/pipeline/sentiment-analysis/distilbert-base-uncased-finetuned-sst-2-english'</span>, {
  method: <span class="string">'POST'</span>,
  headers: { <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span> },
  body: <span class="string">JSON.stringify({ inputs: "I love this product!" })</span>
});

<span class="keyword">const</span> result = <span class="keyword">await</span> response.<span class="function">json</span>();
console.<span class="function">log</span>(result);

<span class="comment">// 下载文件</span>
<span class="keyword">const</span> fileResponse = <span class="keyword">await</span> <span class="function">fetch</span>(<span class="string">'${domain}/bert-base-chinese/resolve/main/pytorch_model.bin'</span>);
<span class="keyword">const</span> blob = <span class="keyword">await</span> fileResponse.<span class="function">blob</span>();
        </div>
      </div>
      
      <div id="git" class="tab-content">
        <div class="code-block">
<span class="comment"># 克隆模型仓库（使用代理）</span>
git clone ${domain}/bert-base-chinese

<span class="comment"># 或者使用 git-lfs 下载大文件</span>
<span class="comment"># 先设置环境变量</span>
<span class="keyword">export</span> HF_ENDPOINT=${domain}

<span class="comment"># 然后正常使用 huggingface-cli</span>
huggingface-cli download bert-base-chinese

<span class="comment"># 下载特定文件</span>
huggingface-cli download bert-base-chinese config.json pytorch_model.bin
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
      
      <div class="feature-card">
        <div class="feature-icon">🚀</div>
        <h3>免费部署</h3>
        <p>基于 Cloudflare Workers，无需服务器，免费额度充足。</p>
      </div>
    </div>

    <div class="card">
      <h2>📚 支持的端点</h2>
      <div class="code-block">
/models/&lt;model-id&gt;                    <span class="comment"># 模型页面</span>
/datasets/&lt;dataset-id&gt;                <span class="comment"># 数据集页面</span>
/spaces/&lt;space-id&gt;                    <span class="comment"># Spaces 页面</span>
/api/models/&lt;model-id&gt;                <span class="comment"># 模型 API</span>
/api/datasets/&lt;dataset-id&gt;            <span class="comment"># 数据集 API</span>
/&lt;model-id&gt;/resolve/main/&lt;file&gt;      <span class="comment"># 下载文件</span>
/&lt;model-id&gt;/blob/main/&lt;file&gt;         <span class="comment"># 查看文件</span>
/pipeline/&lt;task&gt;/&lt;model-id&gt;          <span class="comment"># 推理 API</span>
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
    
    function goToResource() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim();
      if (!path) {
        showToast('请输入资源路径');
        return;
      }
      window.open(\`\${domain}/\${type}/\${path}\`, '_blank');
    }
    
    function copyUrl() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim() || 'bert-base-chinese';
      navigator.clipboard.writeText(\`\${domain}/\${type}/\${path}\`);
      showToast('链接已复制！');
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
    
    // 检查服务状态
    fetch('/health')
      .then(r => r.json())
      .then(() => {
        document.getElementById('statusText').textContent = '服务运行中';
      })
      .catch(() => {
        document.getElementById('statusText').textContent = '服务异常';
        document.querySelector('.status-dot').style.background = 'var(--error)';
      });
    
    updateUrl();
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
  // 静态资源内联在前端 HTML 中，这里返回 404
  return new Response('Not Found', { status: 404 });
}

// Cloudflare Workers 入口
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};
