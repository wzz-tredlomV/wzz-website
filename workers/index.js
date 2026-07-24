/**
 * Hugging Face 代理服务 — 终极版 v4.1
 * 修复: POST 302 重定向、Cookie 重写、登录流程、全子域名代理
 */

// ===== 域名判断 =====
function isHfDomain(hostname) {
  const hfDomains = ['huggingface.co', 'hf.co', 'huggingface.space'];
  for (const domain of hfDomains) {
    if (hostname === domain || hostname.endsWith('.' + domain)) return true;
  }
  return false;
}

function isSpaceDomain(hostname) {
  return hostname.endsWith('.hf.space');
}

function parseSpaceSubdomain(hostname) {
  const base = hostname.replace(/\.hf\.space$/, '');
  const parts = base.split('-');
  if (parts.length < 2) return null;
  if (parts.length === 2) return { user: parts[0], space: parts[1] };
  return { user: parts.slice(0, -1).join('-'), space: parts[parts.length - 1] };
}

function getSpaceSubdomain(user, space) {
  return `${user}-${space}.hf.space`;
}

// ===== CORS =====
function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Auth-Token, X-CSRF-Token, Cache-Control, X-Api-Key, X-Api-Secret, X-Gradio-Event-Id, X-Gradio-Request-Id, Gradio-Client-Hash, Cookie, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-Request-Id, X-Cache-Status, X-Cache-Hits, X-Gradio-Event-Id, X-Gradio-Request-Id, Set-Cookie',
  };
}

// ===== URL 构建 =====
function makeTargetUrl(originalUrl, targetHost, pathname) {
  const u = new URL(originalUrl);
  u.hostname = targetHost;
  u.protocol = 'https';
  if (pathname !== undefined) u.pathname = pathname;
  return u.toString();
}

// ===== 请求头处理 =====
function buildProxyHeaders(request, targetHost, proxyHost) {
  const h = new Headers(request.headers);
  h.set('Host', targetHost);
  h.delete('Referer');
  h.set('Referer', `https://${targetHost}/`);
  h.delete('Origin');
  h.set('Origin', `https://${targetHost}`);
  h.delete('CF-Connecting-IP');
  h.delete('CF-Visitor');
  h.delete('CF-Ray');
  h.delete('CF-Worker');
  h.delete('CF-IPCountry');
  h.delete('CF-Request-ID');
  h.set('X-Forwarded-Host', proxyHost);
  h.set('X-Forwarded-Proto', 'https');
  const realIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
  if (realIp) h.set('X-Forwarded-For', realIp);
  return h;
}

// ===== 解析 Space 路径 =====
function parseSpacePath(pathname) {
  const m = pathname.match(/^\/spaces\/([^\/]+)\/([^\/]+)(.*)$/);
  if (!m) return null;
  return { user: m[1], space: m[2], rest: m[3] || '' };
}

// ===== 判断是否为 Gradio 后端路径 =====
function isGradioBackend(rest) {
  return rest.startsWith('/gradio_api/') ||
         rest === '/config' ||
         rest.startsWith('/assets/') ||
         rest.startsWith('/static/') ||
         rest.startsWith('/file=') ||
         rest.startsWith('/file/') ||
         rest === '/upload' ||
         rest === '/heartbeat' ||
         rest.startsWith('/queue/') ||
         rest.startsWith('/run/') ||
         rest === '/predict' ||
         rest === '/api/predict' ||
         rest === '/reset' ||
         rest === '/app_id' ||
         rest === '/session' ||
         rest === '/login' ||
         rest === '/logout' ||
         rest === '/token' ||
         rest === '/theme.css';
}

// ===== URL 重写：hf.space 返回的内容 =====
function rewriteHfSpaceContent(text, proxyHost, user, space) {
  if (!text || typeof text !== 'string') return text;
  const prefix = `/spaces/${user}/${space}`;
  const subdomain = getSpaceSubdomain(user, space);

  const absRe = new RegExp(
    `https?://${subdomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'g'
  );
  text = text.replace(absRe, `https://${proxyHost}${prefix}`);

  const rewrites = [
    { from: '/gradio_api/', to: `${prefix}/gradio_api/` },
    { from: '/assets/', to: `${prefix}/assets/` },
    { from: '/static/', to: `${prefix}/static/` },
    { from: '/file=', to: `${prefix}/file=` },
    { from: '/file/', to: `${prefix}/file/` },
    { from: '/queue/', to: `${prefix}/queue/` },
    { from: '/run/', to: `${prefix}/run/` },
    { from: '/theme.css', to: `${prefix}/theme.css` },
  ];

  for (const rw of rewrites) {
    const pattern = new RegExp(
      `(["'\s]|^)${rw.from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`,
      'g'
    );
    text = text.replace(pattern, `$1${rw.to}`);
  }

  const exactPaths = [
    { from: '/config', to: `${prefix}/config` },
    { from: '/upload', to: `${prefix}/upload` },
    { from: '/heartbeat', to: `${prefix}/heartbeat` },
    { from: '/predict', to: `${prefix}/predict` },
    { from: '/api/predict', to: `${prefix}/api/predict` },
    { from: '/reset', to: `${prefix}/reset` },
    { from: '/app_id', to: `${prefix}/app_id` },
    { from: '/session', to: `${prefix}/session` },
    { from: '/login', to: `${prefix}/login` },
    { from: '/logout', to: `${prefix}/logout` },
    { from: '/token', to: `${prefix}/token` },
  ];

  for (const rw of exactPaths) {
    const pattern = new RegExp(
      `(["'\s]|^)${rw.from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=["'\s?&/\n]|$)`,
      'g'
    );
    text = text.replace(pattern, `$1${rw.to}`);
  }

  return text;
}

// ===== URL 重写：huggingface.co 返回的 Space 页面 =====
function rewriteHfCoSpaceContent(text, proxyHost, user, space) {
  if (!text || typeof text !== 'string') return text;
  const prefix = `/spaces/${user}/${space}`;
  const subdomain = getSpaceSubdomain(user, space);

  const absRe = new RegExp(
    `https?://${subdomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'g'
  );
  text = text.replace(absRe, `https://${proxyHost}${prefix}`);

  text = text.replace(
    /https?:\/\/huggingface\.co\/spaces\//g,
    `https://${proxyHost}/spaces/`
  );

  return text;
}

// ===== 全局 URL 重写：重写所有 Hugging Face 域名为代理域名 =====
function rewriteAllHfDomains(text, proxyHost) {
  if (!text || typeof text !== 'string') return text;
  const domainMappings = [
    { from: 'huggingface.co', to: proxyHost },
    { from: 'hf.co', to: proxyHost },
    { from: 'huggingface.space', to: proxyHost },
  ];
  for (const mapping of domainMappings) {
    const pattern = new RegExp(
      `https?://${mapping.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'g'
    );
    text = text.replace(pattern, `https://${mapping.to}`);
  }
  return text;
}

// ===== 重写 Set-Cookie 中的 Domain =====
function rewriteSetCookie(headerValue, proxyHost) {
  if (!headerValue) return headerValue;
  // 重写 Domain
  let result = headerValue.replace(/Domain=[.]?[^;]+/gi, `Domain=${proxyHost}`);
  // 删除 Secure 标志（如果代理不是 HTTPS）或保留
  // 删除 SameSite=Strict 改为 SameSite=None（跨域场景）
  // 但保留 Secure 以确保 HTTPS 下 Cookie 正常工作
  return result;
}

// ===== 核心代理函数 =====
async function proxyRequest(request, targetUrl, targetHost, proxyHost, rewriteFn) {
  const proxyHeaders = buildProxyHeaders(request, targetHost, proxyHost);
  const origin = request.headers.get('Origin') || '*';

  try {
    const proxyReq = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'follow',
    });

    const response = await fetch(proxyReq);
    const respHeaders = new Headers(response.headers);
    Object.entries(getCorsHeaders(origin)).forEach(([k, v]) => respHeaders.set(k, v));

    // ===== Cookie 重写（关键修复）=====
    // Cloudflare Workers 的 Headers 支持 getAll 方法获取多个同名头部
    if (respHeaders.getAll) {
      const cookies = respHeaders.getAll('Set-Cookie');
      if (cookies && cookies.length > 0) {
        respHeaders.delete('Set-Cookie');
        for (const cookie of cookies) {
          respHeaders.append('Set-Cookie', rewriteSetCookie(cookie, proxyHost));
        }
      }
    } else {
      // 备用方案：尝试获取单个 Set-Cookie
      const setCookie = respHeaders.get('Set-Cookie');
      if (setCookie) {
        respHeaders.set('Set-Cookie', rewriteSetCookie(setCookie, proxyHost));
      }
    }

    // ===== 重定向处理（关键修复）=====
    if (response.status >= 300 && response.status < 400) {
      const loc = respHeaders.get('Location');
      if (loc) {
        try {
          const locUrl = new URL(loc, targetUrl);
          if (isHfDomain(locUrl.hostname)) {
            // Space 子域名重定向
            if (isSpaceDomain(locUrl.hostname)) {
              const spaceInfo = parseSpaceSubdomain(locUrl.hostname);
              if (spaceInfo) {
                locUrl.pathname = `/spaces/${spaceInfo.user}/${spaceInfo.space}${locUrl.pathname}`;
              }
            }
            locUrl.hostname = proxyHost;
            locUrl.protocol = 'https';
            respHeaders.set('Location', locUrl.toString());
          }
        } catch (e) {
          // 相对路径或其他无法解析的 URL
          if (loc.startsWith('http')) {
            for (const domain of ['huggingface.co', 'hf.co', 'huggingface.space']) {
              if (loc.includes(domain)) {
                const newLoc = loc.replace(/https?:\/\/[^\/]+/, `https://${proxyHost}`);
                respHeaders.set('Location', newLoc);
                break;
              }
            }
          }
        }
      }
    }

    // ===== POST 302 -> 303 转换（关键修复）=====
    // 防止浏览器在跟随重定向时保持 POST 方法，导致"重新发送数据"弹窗
    let finalStatus = response.status;
    if (request.method === 'POST' && response.status === 302) {
      finalStatus = 303; // See Other: 明确将 POST 转为 GET
    }

    // 删除可能干扰代理的安全头部
    respHeaders.delete('Content-Security-Policy');
    respHeaders.delete('X-Frame-Options');
    respHeaders.delete('Strict-Transport-Security');
    respHeaders.delete('Expect-CT');
    respHeaders.delete('Report-To');
    respHeaders.delete('NEL');

    const ct = respHeaders.get('Content-Type') || '';
    const isText = ct.includes('text/') ||
                   ct.includes('application/javascript') ||
                   ct.includes('application/json') ||
                   ct.includes('application/xml') ||
                   ct.includes('application/xhtml');

    const isStream = ct.includes('text/event-stream') ||
                     ct.includes('application/octet-stream') ||
                     ct.includes('video/') ||
                     ct.includes('audio/') ||
                     ct.includes('image/');

    if (rewriteFn && isText && !isStream) {
      const text = await response.text();
      const rewritten = rewriteFn(text);
      respHeaders.delete('Content-Length');
      return new Response(rewritten, {
        status: finalStatus,
        statusText: response.statusText,
        headers: respHeaders,
      });
    }

    return new Response(response.body, {
      status: finalStatus,
      statusText: response.statusText,
      headers: respHeaders,
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return jsonResponse({ error: 'Proxy Error', message: err.message }, 502);
  }
}

// ===== WebSocket 代理 =====
async function proxyWebSocket(request, targetWsUrl) {
  const upgrade = request.headers.get('Upgrade');
  if (upgrade !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  try {
    const [client, server] = Object.values(new WebSocketPair());
    const targetWs = new WebSocket(targetWsUrl);

    server.addEventListener('message', (e) => {
      if (targetWs.readyState === WebSocket.OPEN) targetWs.send(e.data);
    });

    targetWs.addEventListener('message', (e) => {
      if (server.readyState === WebSocket.OPEN) server.send(e.data);
    });

    server.addEventListener('close', () => {
      if (targetWs.readyState === WebSocket.OPEN) targetWs.close();
    });

    targetWs.addEventListener('close', () => {
      if (server.readyState === WebSocket.OPEN) server.close();
    });

    targetWs.addEventListener('error', () => {
      if (server.readyState === WebSocket.OPEN) server.close();
    });

    server.accept();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (err) {
    return jsonResponse({ error: 'WebSocket Proxy Error', message: err.message }, 502);
  }
}

// ===== JSON 响应 =====
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders('*'),
    },
  });
}

// ===== 主处理函数 =====
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const proxyHost = url.hostname;
  const origin = request.headers.get('Origin') || '*';

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
  }

  // 根路径 - 返回前端页面
  if (pathname === '/' || pathname === '/index.html') {
    return serveFrontend(url.origin);
  }

  // 健康检查
  if (pathname === '/health') {
    return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
  }

  // API 信息
  if (pathname === '/api/info') {
    return jsonResponse({
      name: 'Hugging Face Proxy',
      version: '4.1.0',
      endpoints: {
        models: '/models/*',
        datasets: '/datasets/*',
        spaces: '/spaces/<user>/<space>/*',
        gradio_api: '/spaces/<user>/<space>/gradio_api/*',
        api: '/api/*',
        inference: '/pipeline/*',
        login: '/login',
        join: '/join',
        oauth: '/oauth/*',
        settings: '/settings/*',
      },
      features: [
        'Model/Dataset download',
        'Inference API',
        'Gradio Space proxy (full)',
        'WebSocket support',
        'SSE streaming',
        'Smart URL rewriting',
        'Cookie Domain rewriting',
        'OAuth/Login support',
        'All HF subdomains proxy',
        'POST redirect fix (302->303)',
      ],
    });
  }

  // ===== 登录/注册 POST 特殊处理（关键修复）=====
  // 防止登录后重定向到代理前端页面，而是重定向到 HF 的模型页面
  if ((pathname === '/login' || pathname === '/join') && request.method === 'POST') {
    const targetUrl = makeTargetUrl(request.url, 'huggingface.co');
    const response = await proxyRequest(
      request, targetUrl, 'huggingface.co', proxyHost,
      (text) => rewriteAllHfDomains(text, proxyHost)
    );

    // 如果登录成功返回重定向到根路径，改为重定向到 /models
    // 这样用户登录后会看到 HF 的模型页面，而不是代理前端页面
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('Location');
      if (loc) {
        try {
          const locUrl = new URL(loc);
          // 如果重定向到代理域名的根路径，改为 /models
          if (locUrl.hostname === proxyHost && (locUrl.pathname === '/' || locUrl.pathname === '')) {
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Location', `https://${proxyHost}/models`);
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          }
        } catch (e) {
          // 相对路径如 "/"
          if (loc === '/' || loc === '') {
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Location', `https://${proxyHost}/models`);
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          }
        }
      }
    }
    return response;
  }

  // ===== Space 代理 =====
  const spaceInfo = parseSpacePath(pathname);

  if (spaceInfo) {
    const { user, space, rest } = spaceInfo;
    const subdomain = getSpaceSubdomain(user, space);

    // WebSocket 升级
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === 'websocket') {
      const targetWsUrl = `wss://${subdomain}${rest}${url.search}`;
      return proxyWebSocket(request, targetWsUrl);
    }

    // 判断走哪个后端
    if (isGradioBackend(rest)) {
      const targetUrl = makeTargetUrl(request.url, subdomain, rest);
      return proxyRequest(
        request, targetUrl, subdomain, proxyHost,
        (text) => rewriteHfSpaceContent(text, proxyHost, user, space)
      );
    } else {
      const targetUrl = makeTargetUrl(request.url, 'huggingface.co');
      return proxyRequest(
        request, targetUrl, 'huggingface.co', proxyHost,
        (text) => rewriteHfCoSpaceContent(text, proxyHost, user, space)
      );
    }
  }

  // ===== 标准 Hugging Face 代理 =====
  let targetHost = 'huggingface.co';
  if (pathname.startsWith('/api/datasets/')) {
    targetHost = 'datasets-server.huggingface.co';
  } else if (pathname.startsWith('/api/inference/') || pathname.startsWith('/pipeline/')) {
    targetHost = 'api-inference.huggingface.co';
  } else if (pathname.startsWith('/cdn/') || pathname.startsWith('/cdn-lfs/')) {
    targetHost = 'cdn-lfs.huggingface.co';
  }

  const targetUrl = makeTargetUrl(request.url, targetHost);
  return proxyRequest(request, targetUrl, targetHost, proxyHost, (text) => rewriteAllHfDomains(text, proxyHost));
}

// ===== 前端界面 =====
function serveFrontend(domain) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hugging Face 代理 v4.1</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0f172a; --bg-card: #1e293b; --bg-hover: #334155;
      --text: #f1f5f9; --text-muted: #94a3b8;
      --accent: #f59e0b; --accent-light: #fbbf24;
      --border: #334155; --success: #10b981; --error: #ef4444; --gradio: #ff6b6b;
      --info: #3b82f6; --warning: #f59e0b;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh; line-height: 1.6;
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
      background: var(--bg-card); padding: 0.5rem 1rem; border-radius: 2rem;
      margin-top: 1rem; font-size: 0.9rem;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
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
      color: white; border: none; border-radius: 0.5rem; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(245,158,11,0.3); }
    button:active { transform: translateY(0); }
    button.secondary { background: var(--bg-hover); }
    button.secondary:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    button.gradio { background: linear-gradient(135deg, var(--gradio), #ee5a5a); }
    button.gradio:hover { box-shadow: 0 4px 12px rgba(255,107,107,0.3); }
    button.info { background: linear-gradient(135deg, var(--info), #2563eb); }
    button.info:hover { box-shadow: 0 4px 12px rgba(59,130,246,0.3); }
    .url-display {
      background: var(--bg); padding: 1rem; border-radius: 0.5rem;
      font-family: 'Courier New', monospace; font-size: 0.9rem; word-break: break-all;
      border: 1px solid var(--border); margin-bottom: 1rem; position: relative;
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
    .badge-v4 { background: var(--info); color: white; }
    .changelog { background: var(--bg); padding: 1rem; border-radius: 0.5rem; margin-top: 1rem; }
    .changelog li { color: var(--text-muted); margin: 0.5rem 0; }
    .changelog li strong { color: var(--accent-light); }
    .warning-box { background: rgba(245,158,11,0.1); border: 1px solid var(--warning); border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }
    .warning-box p { color: var(--text); font-size: 0.95rem; }
    @media (max-width: 768px) {
      .container { padding: 1rem; } h1 { font-size: 1.8rem; }
      .input-group { flex-direction: column; } .grid { grid-template-columns: 1fr; }
      .tabs { overflow-x: auto; flex-wrap: nowrap; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">🤗</div>
      <h1>Hugging Face 代理 <span class="badge badge-v4">v4.1</span></h1>
      <p class="subtitle">加速访问 Hugging Face 模型、数据集、Spaces 和 Gradio API</p>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span id="statusText">服务运行中</span>
      </div>
    </header>

    <div class="card">
      <h2>🚀 更新日志</h2>
      <ul class="changelog">
        <li><strong>v4.1</strong> — 修复 Login/Signup POST 重定向问题（302→303），登录后自动跳转到模型页面</li>
        <li><strong>v4.0</strong> — 全面修复 Login/Signup/OAuth 支持，重写所有 HF 域名，Cookie Domain 重写</li>
        <li><strong>v3.0</strong> — 重写代理逻辑，修复 Space 页面 404，支持 Gradio Space 完整代理</li>
        <li><strong>v2.0</strong> — 添加 WebSocket、SSE 流式传输支持</li>
        <li><strong>v1.0</strong> — 初始版本，基础 Hugging Face 代理</li>
      </ul>
    </div>

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
      <h2>🔐 登录 / 注册</h2>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">
        通过代理直接访问 Hugging Face 的登录和注册页面。支持 OAuth、SSO 和常规账号密码登录。
      </p>
      <div class="warning-box">
        <p>💡 <strong>提示：</strong>登录成功后将自动跳转到模型页面。登录态通过 Cookie 保持，可在代理域名下正常使用 Hugging Face 的所有功能。</p>
      </div>
      <div class="input-group">
        <button class="info" onclick="window.open('${domain}/login', '_blank')">🔑 登录 (Login)</button>
        <button class="info" onclick="window.open('${domain}/join', '_blank')">✨ 注册 (Sign Up)</button>
        <button class="secondary" onclick="window.open('${domain}/settings/profile', '_blank')">⚙️ 设置</button>
      </div>
      <div class="url-display">
        <span>${domain}/login</span>
        <button class="copy-btn secondary" onclick="navigator.clipboard.writeText('${domain}/login');showToast('登录链接已复制！')">复制</button>
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
        <button class="tab" onclick="switchTab('login')">Login/OAuth</button>
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
      <div id="login" class="tab-content">
        <div class="code-block">
<span class="comment"># 通过代理登录 Hugging Face</span>
<span class="comment"># 1. 浏览器直接访问代理的登录页面</span>
<span class="string">"${domain}/login"</span>

<span class="comment"># 2. 使用 huggingface-cli 登录（通过代理）</span>
<span class="keyword">export</span> HF_ENDPOINT=${domain}
huggingface-cli login

<span class="comment"># 3. 使用 Python 登录（通过代理）</span>
<span class="keyword">from</span> huggingface_hub <span class="keyword">import</span> login
<span class="keyword">import</span> os
os.environ[<span class="string">"HF_ENDPOINT"</span>] = <span class="string">"${domain}"</span>
login()

<span class="comment"># 4. OAuth 授权回调（代理自动处理 redirect_uri）</span>
<span class="comment"># 所有 OAuth 重定向和回调 URL 都会被自动重写为代理域名</span>
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
        <div class="feature-icon">🔐</div>
        <h3>登录 / OAuth 支持 <span class="badge badge-v4">v4.1</span></h3>
        <p>完整支持 Hugging Face 登录、注册、OAuth 授权流程，Cookie Domain 自动重写，POST 重定向修复。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🌐</div>
        <h3>全子域名代理 <span class="badge badge-v4">v4.0</span></h3>
        <p>自动代理所有 Hugging Face 子域名，包括 cdn-lfs、api-inference、datasets-server 等。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🍪</div>
        <h3>Cookie 重写 <span class="badge badge-v4">v4.0</span></h3>
        <p>自动重写 Set-Cookie 中的 Domain 属性，确保登录态在代理域名下正常工作。</p>
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
/api/inference/*                                 <span class="comment"># 推理 API (v4.0)</span>
/cdn-lfs/*                                       <span class="comment"># LFS 文件下载 (v4.0)</span>
/&lt;model-id&gt;/resolve/main/&lt;file&gt;                <span class="comment"># 下载文件</span>
/&lt;model-id&gt;/blob/main/&lt;file&gt;                   <span class="comment"># 查看文件</span>
/pipeline/&lt;task&gt;/&lt;model-id&gt;                  <span class="comment"># 推理 API</span>
/login                                           <span class="comment"># 登录 (v4.1)</span>
/join                                            <span class="comment"># 注册 (v4.1)</span>
/oauth/*                                         <span class="comment"># OAuth (v4.1)</span>
/settings/*                                      <span class="comment"># 用户设置 (v4.1)</span>
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
      document.getElementById('generatedUrl').textContent = domain + '/' + type + '/' + path;
    }
    function updateSpaceUrl() {
      const path = document.getElementById('spacePath').value.trim() || 'username/space-name';
      document.getElementById('spaceUrl').textContent = domain + '/spaces/' + path;
    }
    function goToResource() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim();
      if (!path) { showToast('请输入资源路径'); return; }
      window.open(domain + '/' + type + '/' + path, '_blank');
    }
    function goToSpace() {
      const path = document.getElementById('spacePath').value.trim();
      if (!path) { showToast('请输入 Space 路径'); return; }
      window.open(domain + '/spaces/' + path, '_blank');
    }
    function copyUrl() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim() || 'bert-base-chinese';
      navigator.clipboard.writeText(domain + '/' + type + '/' + path);
      showToast('链接已复制！');
    }
    function copySpaceUrl() {
      const path = document.getElementById('spacePath').value.trim() || 'username/space-name';
      navigator.clipboard.writeText(domain + '/spaces/' + path);
      showToast('Space 链接已复制！');
    }
    function copyGeneratedUrl() {
      navigator.clipboard.writeText(document.getElementById('generatedUrl').textContent);
      showToast('链接已复制！');
    }
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }
    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(name).classList.add('active');
    }
    document.getElementById('resourceType').addEventListener('change', updateUrl);
    document.getElementById('resourcePath').addEventListener('input', updateUrl);
    document.getElementById('spacePath').addEventListener('input', updateSpaceUrl);
    fetch('/health').then(r => r.json()).then(() => {
      document.getElementById('statusText').textContent = '服务运行中';
    }).catch(() => {
      document.getElementById('statusText').textContent = '服务异常';
      document.querySelector('.status-dot').style.background = 'var(--error)';
    });
    updateUrl(); updateSpaceUrl();
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

// Cloudflare Workers 入口
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};
