/**
 * 通用网站代理服务 — 终极版 v5.0
 * 支持任意网站代理，保留HF特殊处理
 * 修复: redirect:manual 防止 fetch 自动跟随重定向
 */

// ==================== 配置 ====================
const CONFIG = {
  // 默认代理目标（当没有指定target参数时）
  defaultTarget: 'huggingface.co',
  // 是否允许代理任意网站（安全考虑）
  allowAnyTarget: true,
  // 黑名单域名（禁止代理的网站）
  blacklist: ['localhost', '127.0.0.1', '::1', 'internal'],
  // 需要特殊处理的域名
  specialDomains: {
    'huggingface.co': { type: 'hf' },
    'hf.co': { type: 'hf' },
    'huggingface.space': { type: 'hf' },
  }
};

// ==================== 工具函数 ====================

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

function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Auth-Token, X-CSRF-Token, Cache-Control, X-Api-Key, X-Api-Secret, X-Gradio-Event-Id, X-Gradio-Request-Id, Gradio-Client-Hash, Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-Request-Id, X-Cache-Status, X-Cache-Hits, X-Gradio-Event-Id, X-Gradio-Request-Id, Set-Cookie',
  };
}

function makeTargetUrl(originalUrl, targetHost, pathname) {
  const u = new URL(originalUrl);
  u.hostname = targetHost;
  u.protocol = 'https';
  if (pathname !== undefined) u.pathname = pathname;
  return u.toString();
}

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

function parseSpacePath(pathname) {
  const m = pathname.match(/^\/spaces\/([^\/]+)\/([^\/]+)(.*)$/);
  if (!m) return null;
  return { user: m[1], space: m[2], rest: m[3] || '' };
}

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

// ==================== 内容重写函数 ====================

// HF Space 内容重写
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

// ==================== 通用内容重写 ====================

function rewriteGenericContent(text, proxyHost, targetHost) {
  if (!text || typeof text !== 'string') return text;
  
  // 重写所有指向目标域名的链接到代理域名
  const targetPattern = new RegExp(
    `https?://${targetHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'g'
  );
  text = text.replace(targetPattern, `https://${proxyHost}`);
  
  // 重写相对路径为绝对路径（处理常见的资源引用）
  // 注意：这里只处理一些明显的情况，不处理所有相对路径
  // 否则可能会破坏页面逻辑
  
  return text;
}

function rewriteSetCookie(headerValue, proxyHost) {
  if (!headerValue) return headerValue;
  return headerValue.replace(
    /Domain=[.]?[^;]+/gi,
    `Domain=${proxyHost}`
  );
}

// ==================== 核心代理函数 ====================

async function proxyRequest(request, targetUrl, targetHost, proxyHost, rewriteFn) {
  const proxyHeaders = buildProxyHeaders(request, targetHost, proxyHost);
  const origin = request.headers.get('Origin') || '*';

  try {
    const proxyReq = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'manual',
    });

    const response = await fetch(proxyReq);
    const respHeaders = new Headers(response.headers);
    Object.entries(getCorsHeaders(origin)).forEach(([k, v]) => respHeaders.set(k, v));

    // Cookie 重写
    if (respHeaders.getAll) {
      const cookies = respHeaders.getAll('Set-Cookie');
      if (cookies && cookies.length > 0) {
        respHeaders.delete('Set-Cookie');
        for (const cookie of cookies) {
          respHeaders.append('Set-Cookie', rewriteSetCookie(cookie, proxyHost));
        }
      }
    } else {
      const setCookie = respHeaders.get('Set-Cookie');
      if (setCookie) {
        respHeaders.set('Set-Cookie', rewriteSetCookie(setCookie, proxyHost));
      }
    }

    // 重定向处理
    if (response.status >= 300 && response.status < 400) {
      const loc = respHeaders.get('Location');
      if (loc) {
        try {
          const locUrl = new URL(loc, targetUrl);
          // 如果重定向到代理过的域名，需要重写
          if (isHfDomain(locUrl.hostname)) {
            // HF 特殊处理
            if (isSpaceDomain(locUrl.hostname)) {
              const spaceInfo = parseSpaceSubdomain(locUrl.hostname);
              if (spaceInfo) {
                locUrl.pathname = `/spaces/${spaceInfo.user}/${spaceInfo.space}${locUrl.pathname}`;
              }
            }
            locUrl.hostname = proxyHost;
            locUrl.protocol = 'https';
            respHeaders.set('Location', locUrl.toString());
          } else if (locUrl.hostname === targetHost) {
            // 重定向到目标域名的，重写为代理域名
            locUrl.hostname = proxyHost;
            locUrl.protocol = 'https';
            respHeaders.set('Location', locUrl.toString());
          }
        } catch (e) {
          // 简单的字符串替换
          if (loc.startsWith('http')) {
            const newLoc = loc.replace(/https?:\/\/[^\/]+/, `https://${proxyHost}`);
            respHeaders.set('Location', newLoc);
          }
        }
      }

      // POST 302 -> 303 转换
      let finalStatus = response.status;
      if (request.method === 'POST' && response.status === 302) {
        finalStatus = 303;
      }

      return new Response(response.body, {
        status: finalStatus,
        statusText: response.statusText,
        headers: respHeaders,
      });
    }

    // 删除安全头部
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
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return jsonResponse({ error: 'Proxy Error', message: err.message }, 502);
  }
}

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
    return new Response(null, { status: 101, webSocket: client });
  } catch (err) {
    return jsonResponse({ error: 'WebSocket Proxy Error', message: err.message }, 502);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders('*'),
    },
  });
}

// ==================== 路由处理 ====================

function getTargetFromPath(pathname) {
  // 格式: /proxy/https://example.com/path
  const match = pathname.match(/^\/proxy\/(https?:\/\/[^\/]+)(\/.*)?$/);
  if (match) {
    const url = new URL(match[1]);
    return {
      host: url.hostname,
      path: match[2] || '/',
      protocol: url.protocol,
    };
  }
  return null;
}

// 检查域名是否在黑名单中
function isBlacklisted(hostname) {
  return CONFIG.blacklist.some(domain => 
    hostname === domain || hostname.endsWith('.' + domain)
  );
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const proxyHost = url.hostname;
  const origin = request.headers.get('Origin') || '*';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
  }

  // ==================== 前端页面 ====================
  if (pathname === '/' || pathname === '/index.html') {
    return serveFrontend(proxyHost);
  }

  // ==================== 健康检查 ====================
  if (pathname === '/health') {
    return jsonResponse({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: '5.0.0',
      features: ['generic-proxy', 'hf-special', 'websocket', 'sse']
    });
  }

  // ==================== API 信息 ====================
  if (pathname === '/api/info') {
    return jsonResponse({
      name: 'Universal Proxy Service',
      version: '5.0.0',
      description: '代理任意网站，同时保留 Hugging Face 特殊处理',
      usage: {
        '代理任意网站': '/proxy/https://example.com/path',
        '代理 Hugging Face': '/models/*, /datasets/*, /spaces/*',
        'Gradio Space': '/spaces/<user>/<space>/*',
      },
      features: [
        '任意网站代理',
        'Hugging Face 模型/数据集下载',
        'Inference API',
        'Gradio Space 代理',
        'WebSocket 支持',
        'SSE 流式传输',
        '智能 URL 重写',
        'Cookie Domain 重写',
        'OAuth/Login 支持',
        'POST 重定向修复',
      ],
    });
  }

  // ==================== HF 特殊路由（保留） ====================
  
  // HF Space 路由
  const spaceInfo = parseSpacePath(pathname);
  if (spaceInfo) {
    const { user, space, rest } = spaceInfo;
    const subdomain = getSpaceSubdomain(user, space);

    const upgrade = request.headers.get('Upgrade');
    if (upgrade === 'websocket') {
      const targetWsUrl = `wss://${subdomain}${rest}${url.search}`;
      return proxyWebSocket(request, targetWsUrl);
    }

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

  // HF 模型/数据集路由
  if (pathname.startsWith('/models/') || 
      pathname.startsWith('/datasets/') ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/pipeline/') ||
      pathname.startsWith('/cdn/') ||
      pathname.startsWith('/cdn-lfs/') ||
      pathname === '/login' ||
      pathname === '/join' ||
      pathname.startsWith('/oauth/') ||
      pathname.startsWith('/settings/') ||
      pathname.startsWith('/docs/')) {
    
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

  // ==================== 通用代理路由 ====================
  
  // 格式: /proxy/https://example.com/path
  const proxyTarget = getTargetFromPath(pathname);
  if (proxyTarget && CONFIG.allowAnyTarget) {
    const { host, path, protocol } = proxyTarget;
    
    // 检查黑名单
    if (isBlacklisted(host)) {
      return jsonResponse({ error: 'Target domain is blacklisted' }, 403);
    }
    
    const targetUrl = makeTargetUrl(request.url, host, path + url.search);
    
    // 检查是否需要特殊处理
    let rewriteFn = null;
    if (isHfDomain(host)) {
      rewriteFn = (text) => rewriteAllHfDomains(text, proxyHost);
    } else {
      rewriteFn = (text) => rewriteGenericContent(text, proxyHost, host);
    }
    
    return proxyRequest(request, targetUrl, host, proxyHost, rewriteFn);
  }

  // ==================== 返回 404 ====================
  return jsonResponse({
    error: 'Not Found',
    message: '请使用 /proxy/https://example.com 格式代理网站',
    usage: {
      '代理任意网站': '/proxy/https://example.com/path',
      '代理 Hugging Face 模型': '/models/bert-base-chinese',
      '代理 Hugging Face Space': '/spaces/username/space-name',
    }
  }, 404);
}

// ==================== 前端页面 ====================

function serveFrontend(domain) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>通用网站代理 v5.0</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0f172a; --bg-card: #1e293b; --bg-hover: #334155;
      --text: #f1f5f9; --text-muted: #94a3b8;
      --accent: #f59e0b; --accent-light: #fbbf24;
      --border: #334155; --success: #10b981; --error: #ef4444;
      --info: #3b82f6; --warning: #f59e0b; --purple: #8b5cf6;
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
      background: linear-gradient(135deg, var(--accent), var(--purple));
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
    .input-group { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    input[type="text"], select {
      flex: 1; padding: 0.75rem 1rem; background: var(--bg); border: 1px solid var(--border);
      border-radius: 0.5rem; color: var(--text); font-size: 1rem; outline: none; transition: border-color 0.2s;
      min-width: 200px;
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
    button.gradio { background: linear-gradient(135deg, #ff6b6b, #ee5a5a); }
    button.gradio:hover { box-shadow: 0 4px 12px rgba(255,107,107,0.3); }
    button.info { background: linear-gradient(135deg, var(--info), #2563eb); }
    button.info:hover { box-shadow: 0 4px 12px rgba(59,130,246,0.3); }
    button.purple { background: linear-gradient(135deg, var(--purple), #7c3aed); }
    button.purple:hover { box-shadow: 0 4px 12px rgba(139,92,246,0.3); }
    .url-display {
      background: var(--bg); padding: 1rem; border-radius: 0.5rem;
      font-family: 'Courier New', monospace; font-size: 0.9rem; word-break: break-all;
      border: 1px solid var(--border); margin-bottom: 1rem; position: relative;
    }
    .copy-btn { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); padding: 0.25rem 0.75rem; font-size: 0.8rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
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
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.8rem; font-weight: 600; margin-left: 0.5rem; }
    .badge-new { background: var(--purple); color: white; }
    .badge-v5 { background: var(--info); color: white; }
    .badge-hf { background: #ff6b6b; color: white; }
    .footer { text-align: center; padding: 2rem; color: var(--text-muted); border-top: 1px solid var(--border); margin-top: 2rem; }
    .toast {
      position: fixed; bottom: 2rem; right: 2rem; background: var(--success); color: white;
      padding: 1rem 1.5rem; border-radius: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transform: translateY(100px); opacity: 0; transition: all 0.3s; z-index: 1000;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    .changelog { background: var(--bg); padding: 1rem; border-radius: 0.5rem; margin-top: 1rem; }
    .changelog li { color: var(--text-muted); margin: 0.5rem 0; }
    .changelog li strong { color: var(--accent-light); }
    .warning-box { background: rgba(245,158,11,0.1); border: 1px solid var(--warning); border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }
    .warning-box p { color: var(--text); font-size: 0.95rem; }
    @media (max-width: 768px) {
      .container { padding: 1rem; } h1 { font-size: 1.8rem; }
      .input-group { flex-direction: column; } .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">🌐</div>
      <h1>通用网站代理 <span class="badge badge-v5">v5.0</span></h1>
      <p class="subtitle">代理任意网站 | 完整支持 Hugging Face 生态</p>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span id="statusText">服务运行中</span>
      </div>
    </header>

    <!-- 通用代理 -->
    <div class="card">
      <h2>🔗 代理任意网站</h2>
      <p style="color: var(--text-muted); margin-bottom: 1rem;">
        输入要代理的 URL，即可通过本服务访问
      </p>
      <div class="input-group">
        <input type="text" id="genericUrl" placeholder="https://example.com" value="https://example.com">
        <button class="purple" onclick="goToGeneric()">🚀 访问</button>
        <button class="secondary" onclick="copyGenericUrl()">📋 复制链接</button>
      </div>
      <div class="url-display">
        <span id="genericUrlDisplay">${domain}/proxy/https://example.com</span>
        <button class="copy-btn secondary" onclick="copyGeneratedUrl()">复制</button>
      </div>
    </div>

    <!-- Hugging Face 代理 -->
    <div class="card">
      <h2>🤗 Hugging Face 代理 <span class="badge badge-hf">HF</span></h2>
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
      <div class="url-display">
        <span id="hfUrlDisplay">${domain}/models/bert-base-chinese</span>
        <button class="copy-btn secondary" onclick="copyHfUrl()">复制</button>
      </div>
    </div>

    <!-- 更新日志 -->
    <div class="card">
      <h2>📝 更新日志</h2>
      <ul class="changelog">
        <li><strong>v5.0</strong> — 升级为通用代理，支持任意网站，保留 HF 完整支持</li>
        <li><strong>v4.2</strong> — 修复"重新发送数据"弹窗：fetch 改为 manual 模式</li>
        <li><strong>v4.1</strong> — 修复 Login/Signup POST 302→303 转换</li>
        <li><strong>v4.0</strong> — 全面修复 Login/Signup/OAuth 支持</li>
        <li><strong>v3.0</strong> — 重写代理逻辑，修复 Space 页面 404</li>
      </ul>
    </div>

    <!-- 功能卡片 -->
    <div class="grid">
      <div class="feature-card">
        <div class="feature-icon">🌐</div>
        <h3>通用代理</h3>
        <p>代理任意 HTTP/HTTPS 网站，自动重写链接和 Cookie</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3>HF 加速</h3>
        <p>通过全球 CDN 网络加速 Hugging Face 模型和数据集下载</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🎨</div>
        <h3>Gradio Space</h3>
        <p>完整支持 Gradio Space，包括 WebSocket、SSE 流式传输</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🔐</div>
        <h3>登录支持</h3>
        <p>支持任意网站的登录、Cookie 保持和会话管理</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🍪</div>
        <h3>Cookie 重写</h3>
        <p>自动重写 Set-Cookie 中的 Domain 属性</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📡</div>
        <h3>WebSocket</h3>
        <p>支持 WebSocket 连接代理，适用于实时应用</p>
      </div>
    </div>

    <!-- 使用示例 -->
    <div class="card">
      <h2>💻 使用示例</h2>
      <div class="code-block">
<span class="comment"># 代理任意网站</span>
${domain}/proxy/https://example.com/path

<span class="comment"># 代理 Hugging Face 模型</span>
${domain}/models/bert-base-chinese

<span class="comment"># 代理 Hugging Face Space</span>
${domain}/spaces/username/space-name

<span class="comment"># 调用 Gradio Space API</span>
${domain}/spaces/username/space-name/gradio_api/call/predict

<span class="comment"># 使用环境变量</span>
<span class="keyword">export</span> HF_ENDPOINT=${domain}
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Made with ❤️ | 基于 Cloudflare Workers 构建</p>
    <p style="margin-top: 0.5rem; font-size: 0.9rem;">此服务仅供学习和研究使用</p>
  </div>

  <div class="toast" id="toast">已复制到剪贴板！</div>

  <script>
    const domain = window.location.origin;
    
    // 通用代理
    function updateGenericUrl() {
      const url = document.getElementById('genericUrl').value.trim() || 'https://example.com';
      document.getElementById('genericUrlDisplay').textContent = domain + '/proxy/' + url;
    }
    
    function goToGeneric() {
      const url = document.getElementById('genericUrl').value.trim();
      if (!url) { showToast('请输入 URL'); return; }
      window.open(domain + '/proxy/' + url, '_blank');
    }
    
    function copyGenericUrl() {
      const url = document.getElementById('genericUrl').value.trim() || 'https://example.com';
      navigator.clipboard.writeText(domain + '/proxy/' + url);
      showToast('链接已复制！');
    }
    
    // HF 代理
    function updateHfUrl() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim() || 'bert-base-chinese';
      document.getElementById('hfUrlDisplay').textContent = domain + '/' + type + '/' + path;
    }
    
    function goToResource() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim();
      if (!path) { showToast('请输入资源路径'); return; }
      window.open(domain + '/' + type + '/' + path, '_blank');
    }
    
    function copyHfUrl() {
      const type = document.getElementById('resourceType').value;
      const path = document.getElementById('resourcePath').value.trim() || 'bert-base-chinese';
      navigator.clipboard.writeText(domain + '/' + type + '/' + path);
      showToast('链接已复制！');
    }
    
    function copyGeneratedUrl() {
      const text = document.getElementById('genericUrlDisplay').textContent;
      navigator.clipboard.writeText(text);
      showToast('链接已复制！');
    }
    
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }
    
    // 事件绑定
    document.getElementById('genericUrl').addEventListener('input', updateGenericUrl);
    document.getElementById('resourceType').addEventListener('change', updateHfUrl);
    document.getElementById('resourcePath').addEventListener('input', updateHfUrl);
    
    // 健康检查
    fetch('/health').then(r => r.json()).then(() => {
      document.getElementById('statusText').textContent = '服务运行中';
    }).catch(() => {
      document.getElementById('statusText').textContent = '服务异常';
      document.querySelector('.status-dot').style.background = 'var(--error)';
    });
    
    // 初始化
    updateGenericUrl();
    updateHfUrl();
    
    // 回车键支持
    document.getElementById('genericUrl').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') goToGeneric();
    });
    document.getElementById('resourcePath').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') goToResource();
    });
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

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};