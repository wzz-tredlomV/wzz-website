/**
 * 通用网站代理 + Hugging Face 专用代理 v5.0
 * 修复: serveFrontend 模板字符串冲突导致的客户端错误
 * 支持：任意网站代理（通过 /proxy/<target>）+ 完整的 Hugging Face 代理
 */

// ==================== 配置 ====================

const HF_DOMAINS = ['huggingface.co', 'hf.co', 'huggingface.space'];
const HF_API_HOSTS = {
  '/api/datasets/': 'datasets-server.huggingface.co',
  '/api/inference/': 'api-inference.huggingface.co',
  '/pipeline/': 'api-inference.huggingface.co',
  '/cdn/': 'cdn-lfs.huggingface.co',
  '/cdn-lfs/': 'cdn-lfs.huggingface.co',
};

// ==================== 工具函数 ====================

function isHfDomain(hostname) {
  for (const domain of HF_DOMAINS) {
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
  return user + '-' + space + '.hf.space';
}

function getCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Auth-Token, X-CSRF-Token, Cache-Control, X-Api-Key, X-Api-Secret, X-Gradio-Event-Id, X-Gradio-Request-Id, Gradio-Client-Hash, Cookie, X-Proxy-Target',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-Request-Id, X-Cache-Status, X-Cache-Hits, X-Gradio-Event-Id, X-Gradio-Request-Id, Set-Cookie, Location',
  };
}

function makeTargetUrl(originalUrl, targetHost, pathname) {
  const u = new URL(originalUrl);
  u.hostname = targetHost;
  u.protocol = 'https';
  if (pathname !== undefined) u.pathname = pathname;
  u.searchParams.delete('target');
  u.searchParams.delete('rewrite');
  return u.toString();
}

function buildProxyHeaders(request, targetHost, proxyHost) {
  const h = new Headers(request.headers);
  h.set('Host', targetHost);
  h.delete('Referer');
  h.set('Referer', 'https://' + targetHost + '/');
  h.delete('Origin');
  h.set('Origin', 'https://' + targetHost);
  const cfHeaders = ['CF-Connecting-IP', 'CF-Visitor', 'CF-Ray', 'CF-Worker', 'CF-IPCountry', 'CF-Request-ID'];
  for (const cfh of cfHeaders) h.delete(cfh);
  h.set('X-Forwarded-Host', proxyHost);
  h.set('X-Forwarded-Proto', 'https');
  const realIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
  if (realIp) h.set('X-Forwarded-For', realIp);
  h.delete('X-Proxy-Target');
  return h;
}

function parseSpacePath(pathname) {
  const m = pathname.match(/^\/spaces\/([^\/]+)\/([^\/]+)(.*)$/);
  if (!m) return null;
  return { user: m[1], space: m[2], rest: m[3] || '' };
}

function isGradioBackend(rest) {
  const gradioPaths = [
    '/gradio_api/', '/config', '/assets/', '/static/', '/file=', '/file/',
    '/upload', '/heartbeat', '/queue/', '/run/', '/predict', '/api/predict',
    '/reset', '/app_id', '/session', '/login', '/logout', '/token', '/theme.css'
  ];
  return gradioPaths.some(p => rest === p || rest.startsWith(p));
}

// ==================== 内容重写函数 ====================

function rewriteHfSpaceContent(text, proxyHost, user, space) {
  if (!text || typeof text !== 'string') return text;
  const prefix = '/spaces/' + user + '/' + space;
  const subdomain = getSpaceSubdomain(user, space);
  const absRe = new RegExp(
    'https?://' + subdomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g'
  );
  text = text.replace(absRe, 'https://' + proxyHost + prefix);
  const rewrites = [
    { from: '/gradio_api/', to: prefix + '/gradio_api/' },
    { from: '/assets/', to: prefix + '/assets/' },
    { from: '/static/', to: prefix + '/static/' },
    { from: '/file=', to: prefix + '/file=' },
    { from: '/file/', to: prefix + '/file/' },
    { from: '/queue/', to: prefix + '/queue/' },
    { from: '/run/', to: prefix + '/run/' },
    { from: '/theme.css', to: prefix + '/theme.css' },
  ];
  for (const rw of rewrites) {
    const pattern = new RegExp(
      '(["\'\\s]|^)' + rw.from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'),
      'g'
    );
    text = text.replace(pattern, '$1' + rw.to);
  }
  const exactPaths = [
    '/config', '/upload', '/heartbeat', '/predict', '/api/predict',
    '/reset', '/app_id', '/session', '/login', '/logout', '/token'
  ];
  for (const ep of exactPaths) {
    const pattern = new RegExp(
      '(["\'\\s]|^)' + ep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(?=["\'\\s?&/\n]|$)',
      'g'
    );
    text = text.replace(pattern, '$1' + prefix + ep);
  }
  return text;
}

function rewriteHfCoSpaceContent(text, proxyHost, user, space) {
  if (!text || typeof text !== 'string') return text;
  const prefix = '/spaces/' + user + '/' + space;
  const subdomain = getSpaceSubdomain(user, space);
  const absRe = new RegExp(
    'https?://' + subdomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g'
  );
  text = text.replace(absRe, 'https://' + proxyHost + prefix);
  text = text.replace(
    /https?:\/\/huggingface\.co\/spaces\//g,
    'https://' + proxyHost + '/spaces/'
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
      'https?://' + mapping.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g'
    );
    text = text.replace(pattern, 'https://' + mapping.to);
  }
  return text;
}

/**
 * 通用内容重写：将目标域名的绝对 URL 替换为代理 URL
 */
function rewriteGenericContent(text, targetHost, proxyHost, targetPathPrefix) {
  if (!text || typeof text !== 'string') return text;

  const escapedHost = targetHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absPattern = new RegExp('https?://' + escapedHost + '([^"'>\\s]*)', 'g');
  text = text.replace(absPattern, function(match, path) {
    return 'https://' + proxyHost + targetPathPrefix + path;
  });

  const protoRelPattern = new RegExp('(["'])(//' + escapedHost + '[^"'>\\s]*)', 'g');
  text = text.replace(protoRelPattern, '$1//' + proxyHost + targetPathPrefix + '$2');

  const rootPathPattern = /((?:href|src|action)=["'])\/([^"']*)/g;
  text = text.replace(rootPathPattern, function(match, attr, path) {
    if (path.startsWith('proxy/') || path.startsWith('spaces/')) return match;
    return attr + targetPathPrefix + '/' + path;
  });

  return text;
}

function rewriteSetCookie(headerValue, proxyHost) {
  if (!headerValue) return headerValue;
  return headerValue.replace(
    /Domain=[.]?[^;]+/gi,
    'Domain=' + proxyHost
  );
}

// ==================== 核心代理函数 ====================

async function proxyRequest(request, targetUrl, targetHost, proxyHost, rewriteFn, options) {
  options = options || {};
  const proxyHeaders = buildProxyHeaders(request, targetHost, proxyHost);
  const origin = request.headers.get('Origin') || '*';
  const isGenericProxy = options.isGenericProxy || false;
  const targetPathPrefix = options.targetPathPrefix || '';

  try {
    const proxyReq = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'manual',
    });

    const response = await fetch(proxyReq);
    const respHeaders = new Headers(response.headers);

    Object.entries(getCorsHeaders(origin)).forEach(function([k, v]) { respHeaders.set(k, v); });

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

    if (response.status >= 300 && response.status < 400) {
      const loc = respHeaders.get('Location');
      if (loc) {
        try {
          const locUrl = new URL(loc, targetUrl);

          if (isHfDomain(locUrl.hostname)) {
            if (isSpaceDomain(locUrl.hostname)) {
              const spaceInfo = parseSpaceSubdomain(locUrl.hostname);
              if (spaceInfo) {
                locUrl.pathname = '/spaces/' + spaceInfo.user + '/' + spaceInfo.space + locUrl.pathname;
              }
            }
            locUrl.hostname = proxyHost;
            locUrl.protocol = 'https';
            respHeaders.set('Location', locUrl.toString());
          } else if (isGenericProxy) {
            const redirectPath = '/proxy/' + locUrl.hostname + locUrl.pathname + locUrl.search;
            locUrl.hostname = proxyHost;
            locUrl.protocol = 'https';
            locUrl.pathname = redirectPath;
            locUrl.search = '';
            respHeaders.set('Location', locUrl.toString());
          }
        } catch (e) {
          if (loc.startsWith('http') && isGenericProxy) {
            for (const domain of HF_DOMAINS) {
              if (loc.includes(domain)) {
                const newLoc = loc.replace(/https?:\/\/[^\/]+/, 'https://' + proxyHost);
                respHeaders.set('Location', newLoc);
                break;
              }
            }
          } else if (isGenericProxy && !loc.startsWith('http')) {
            const baseUrl = new URL(targetUrl);
            const redirectPath = '/proxy/' + baseUrl.hostname + (loc.startsWith('/') ? '' : '/') + loc;
            respHeaders.set('Location', 'https://' + proxyHost + redirectPath);
          }
        }
      }

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

    const securityHeaders = ['Content-Security-Policy', 'X-Frame-Options', 'Strict-Transport-Security', 'Expect-CT', 'Report-To', 'NEL'];
    for (const sh of securityHeaders) respHeaders.delete(sh);

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
    server.addEventListener('message', function(e) {
      if (targetWs.readyState === WebSocket.OPEN) targetWs.send(e.data);
    });
    targetWs.addEventListener('message', function(e) {
      if (server.readyState === WebSocket.OPEN) server.send(e.data);
    });
    server.addEventListener('close', function() {
      if (targetWs.readyState === WebSocket.OPEN) targetWs.close();
    });
    targetWs.addEventListener('close', function() {
      if (server.readyState === WebSocket.OPEN) server.close();
    });
    targetWs.addEventListener('error', function() {
      if (server.readyState === WebSocket.OPEN) server.close();
    });
    server.accept();
    return new Response(null, { status: 101, webSocket: client });
  } catch (err) {
    return jsonResponse({ error: 'WebSocket Proxy Error', message: err.message }, 502);
  }
}

function jsonResponse(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders('*'),
    },
  });
}

// ==================== 路由处理 ====================

async function handleGenericProxy(request, env, targetUrlStr) {
  const url = new URL(request.url);
  const proxyHost = url.hostname;

  let targetUrl;
  let targetHost;

  try {
    if (targetUrlStr.startsWith('http://') || targetUrlStr.startsWith('https://')) {
      const parsed = new URL(targetUrlStr);
      targetHost = parsed.hostname;
      const originalPath = url.pathname.replace(/^\/proxy\/[^\/]+/, '') || '/';
      targetUrl = new URL(originalPath + url.search, targetUrlStr);
    } else {
      targetHost = targetUrlStr.split('/')[0];
      const path = targetUrlStr.includes('/') ? targetUrlStr.substring(targetUrlStr.indexOf('/')) : '/';
      const originalPath = url.pathname.replace(/^\/proxy\/[^\/]+/, '') || path;
      targetUrl = new URL('https://' + targetHost + originalPath + url.search);
    }
  } catch (e) {
    return jsonResponse({ error: 'Invalid target URL', message: e.message }, 400);
  }

  if (targetHost === proxyHost || (targetHost.includes('workers.dev') && proxyHost.includes('workers.dev'))) {
    return jsonResponse({ error: 'Loop detected', message: 'Cannot proxy to self' }, 400);
  }

  const targetPathPrefix = '/proxy/' + targetHost;

  const rewriteFn = function(text) { return rewriteGenericContent(text, targetHost, proxyHost, targetPathPrefix); };

  return proxyRequest(request, targetUrl.toString(), targetHost, proxyHost, rewriteFn, {
    isGenericProxy: true,
    targetPathPrefix: targetPathPrefix
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const proxyHost = url.hostname;
  const origin = request.headers.get('Origin') || '*';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
  }

  if (pathname === '/health') {
    return jsonResponse({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      mode: 'universal-proxy',
      version: '5.0.0'
    });
  }

  if (pathname === '/api/info') {
    return jsonResponse({
      name: 'Universal Web Proxy + HF Proxy',
      version: '5.0.0',
      features: [
        'Universal website proxy via /proxy/<target>',
        'Hugging Face full proxy',
        'Gradio Space proxy',
        'WebSocket support',
        'SSE streaming',
        'Cookie rewriting',
        'Content URL rewriting',
      ],
      usage: {
        generic: '/proxy/<target-domain>/<path>?target=<full-url>',
        hf_models: '/models/<model-id>',
        hf_datasets: '/datasets/<dataset-id>',
        hf_spaces: '/spaces/<user>/<space>',
        hf_login: '/login',
      }
    });
  }

  // 通用代理路由
  if (pathname.startsWith('/proxy/')) {
    const pathTarget = pathname.replace(/^\/proxy\//, '').split('/')[0];
    const queryTarget = url.searchParams.get('target');
    const target = queryTarget || pathTarget || url.searchParams.get('url');

    if (target) {
      return handleGenericProxy(request, env, target);
    }
  }

  const directTarget = url.searchParams.get('target') || url.searchParams.get('url');
  if (directTarget && (pathname === '/' || pathname === '')) {
    return handleGenericProxy(request, env, directTarget);
  }

  // Hugging Face 专用路由
  if (pathname === '/' || pathname === '/index.html') {
    if (directTarget) {
      return handleGenericProxy(request, env, directTarget);
    }
    const targetUrl = makeTargetUrl(request.url, 'huggingface.co');
    return proxyRequest(request, targetUrl, 'huggingface.co', proxyHost, function(text) { return rewriteAllHfDomains(text, proxyHost); });
  }

  const spaceInfo = parseSpacePath(pathname);
  if (spaceInfo) {
    const user = spaceInfo.user;
    const space = spaceInfo.space;
    const rest = spaceInfo.rest;
    const subdomain = getSpaceSubdomain(user, space);

    const upgrade = request.headers.get('Upgrade');
    if (upgrade === 'websocket') {
      const targetWsUrl = 'wss://' + subdomain + rest + url.search;
      return proxyWebSocket(request, targetWsUrl);
    }

    if (isGradioBackend(rest)) {
      const targetUrl = makeTargetUrl(request.url, subdomain, rest);
      return proxyRequest(
        request, targetUrl, subdomain, proxyHost,
        function(text) { return rewriteHfSpaceContent(text, proxyHost, user, space); }
      );
    } else {
      const targetUrl = makeTargetUrl(request.url, 'huggingface.co');
      return proxyRequest(
        request, targetUrl, 'huggingface.co', proxyHost,
        function(text) { return rewriteHfCoSpaceContent(text, proxyHost, user, space); }
      );
    }
  }

  let targetHost = 'huggingface.co';
  for (const [prefix, host] of Object.entries(HF_API_HOSTS)) {
    if (pathname.startsWith(prefix)) {
      targetHost = host;
      break;
    }
  }

  const targetUrl = makeTargetUrl(request.url, targetHost);
  return proxyRequest(request, targetUrl, targetHost, proxyHost, function(text) { return rewriteAllHfDomains(text, proxyHost); });
}

// ==================== 前端页面 ====================
// 关键修复：使用字符串拼接代替模板字符串，避免 ${domain} 冲突

function serveFrontend(domain) {
  const html = '<!DOCTYPE html>' +
'<html lang="zh-CN">' +
'<head>' +
'  <meta charset="UTF-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <title>Universal Web Proxy v5.0</title>' +
'  <style>' +
'    * { margin: 0; padding: 0; box-sizing: border-box; }' +
'    :root {' +
'      --bg: #0f172a; --bg-card: #1e293b; --bg-hover: #334155;' +
'      --text: #f1f5f9; --text-muted: #94a3b8;' +
'      --accent: #f59e0b; --accent-light: #fbbf24;' +
'      --border: #334155; --success: #10b981; --error: #ef4444;' +
'      --info: #3b82f6; --warning: #f59e0b; --gradio: #ff6b6b;' +
'    }' +
'    body {' +
'      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
'      background: var(--bg); color: var(--text); min-height: 100vh; line-height: 1.6;' +
'    }' +
'    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }' +
'    header { text-align: center; padding: 3rem 0; border-bottom: 1px solid var(--border); margin-bottom: 2rem; }' +
'    h1 {' +
'      font-size: 2.5rem;' +
'      background: linear-gradient(135deg, var(--accent), var(--accent-light));' +
'      -webkit-background-clip: text; -webkit-text-fill-color: transparent;' +
'      margin-bottom: 0.5rem;' +
'    }' +
'    .subtitle { color: var(--text-muted); font-size: 1.1rem; }' +
'    .status-badge {' +
'      display: inline-flex; align-items: center; gap: 0.5rem;' +
'      background: var(--bg-card); padding: 0.5rem 1rem; border-radius: 2rem;' +
'      margin-top: 1rem; font-size: 0.9rem;' +
'    }' +
'    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; }' +
'    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }' +
'    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 1rem; padding: 2rem; margin-bottom: 2rem; }' +
'    .card h2 { font-size: 1.5rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }' +
'    .input-group { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }' +
'    input[type="text"], select, textarea {' +
'      flex: 1; min-width: 200px; padding: 0.75rem 1rem; background: var(--bg); border: 1px solid var(--border);' +
'      border-radius: 0.5rem; color: var(--text); font-size: 1rem; outline: none; transition: border-color 0.2s;' +
'      font-family: inherit;' +
'    }' +
'    input[type="text"]:focus, select:focus, textarea:focus { border-color: var(--accent); }' +
'    textarea { min-height: 120px; resize: vertical; font-family: monospace; }' +
'    button {' +
'      padding: 0.75rem 1.5rem; background: linear-gradient(135deg, var(--accent), #d97706);' +
'      color: white; border: none; border-radius: 0.5rem; font-size: 1rem; font-weight: 600;' +
'      cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;' +
'    }' +
'    button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(245,158,11,0.3); }' +
'    button:active { transform: translateY(0); }' +
'    button.secondary { background: var(--bg-hover); }' +
'    button.secondary:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.2); }' +
'    button.info { background: linear-gradient(135deg, var(--info), #2563eb); }' +
'    button.info:hover { box-shadow: 0 4px 12px rgba(59,130,246,0.3); }' +
'    button.gradio { background: linear-gradient(135deg, var(--gradio), #ee5a5a); }' +
'    button.gradio:hover { box-shadow: 0 4px 12px rgba(255,107,107,0.3); }' +
'    .url-display {' +
'      background: var(--bg); padding: 1rem; border-radius: 0.5rem;' +
'      font-family: "Courier New", monospace; font-size: 0.9rem; word-break: break-all;' +
'      border: 1px solid var(--border); margin-bottom: 1rem; position: relative;' +
'    }' +
'    .copy-btn { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); padding: 0.25rem 0.75rem; font-size: 0.8rem; }' +
'    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }' +
'    .feature-card {' +
'      background: var(--bg-card); border: 1px solid var(--border); border-radius: 1rem;' +
'      padding: 1.5rem; transition: transform 0.2s, border-color 0.2s;' +
'    }' +
'    .feature-card:hover { transform: translateY(-4px); border-color: var(--accent); }' +
'    .feature-icon { font-size: 2rem; margin-bottom: 0.5rem; }' +
'    .feature-card h3 { margin-bottom: 0.5rem; color: var(--accent-light); }' +
'    .feature-card p { color: var(--text-muted); font-size: 0.95rem; }' +
'    .code-block {' +
'      background: #0d1117; border: 1px solid #30363d; border-radius: 0.5rem;' +
'      padding: 1rem; overflow-x: auto; font-family: "Courier New", monospace;' +
'      font-size: 0.85rem; line-height: 1.5; margin: 1rem 0;' +
'    }' +
'    .code-block .comment { color: #8b949e; }' +
'    .code-block .string { color: #a5d6ff; }' +
'    .code-block .keyword { color: #ff7b72; }' +
'    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; flex-wrap: wrap; }' +
'    .tab { padding: 0.5rem 1rem; background: none; border: none; color: var(--text-muted); cursor: pointer; border-radius: 0.25rem; font-size: 0.9rem; }' +
'    .tab.active { background: var(--bg-hover); color: var(--text); }' +
'    .tab-content { display: none; }' +
'    .tab-content.active { display: block; }' +
'    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.8rem; font-weight: 600; margin-left: 0.5rem; }' +
'    .badge-new { background: var(--gradio); color: white; }' +
'    .badge-v5 { background: var(--info); color: white; }' +
'    .warning-box { background: rgba(245,158,11,0.1); border: 1px solid var(--warning); border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }' +
'    .warning-box p { color: var(--text); font-size: 0.95rem; }' +
'    .mode-switch { display: flex; gap: 1rem; margin-bottom: 1rem; justify-content: center; }' +
'    .mode-btn { padding: 0.5rem 1.5rem; border-radius: 2rem; border: 2px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.2s; }' +
'    .mode-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(245,158,11,0.1); }' +
'    .section { display: none; }' +
'    .section.active { display: block; }' +
'    footer { text-align: center; padding: 2rem; color: var(--text-muted); border-top: 1px solid var(--border); margin-top: 2rem; }' +
'    .toast {' +
'      position: fixed; bottom: 2rem; right: 2rem; background: var(--success); color: white;' +
'      padding: 1rem 1.5rem; border-radius: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3);' +
'      transform: translateY(100px); opacity: 0; transition: all 0.3s; z-index: 1000;' +
'    }' +
'    .toast.show { transform: translateY(0); opacity: 1; }' +
'    @media (max-width: 768px) {' +
'      .container { padding: 1rem; } h1 { font-size: 1.8rem; }' +
'      .input-group { flex-direction: column; } .grid { grid-template-columns: 1fr; }' +
'    }' +
'  </style>' +
'</head>' +
'<body>' +
'  <div class="container">' +
'    <header>' +
'      <div class="logo" style="font-size: 3rem; margin-bottom: 0.5rem;">🌐</div>' +
'      <h1>Universal Web Proxy <span class="badge badge-v5">v5.0</span></h1>' +
'      <p class="subtitle">通用网站代理 + Hugging Face 专用代理</p>' +
'      <div class="status-badge">' +
'        <span class="status-dot"></span>' +
'        <span id="statusText">服务运行中</span>' +
'      </div>' +
'    </header>' +
'' +
'    <div class="mode-switch">' +
'      <button class="mode-btn active" onclick="switchMode("generic")">🌍 通用代理</button>' +
'      <button class="mode-btn" onclick="switchMode("hf")">🤗 Hugging Face</button>' +
'    </div>' +
'' +
'    <div id="generic-panel" class="section active">' +
'      <div class="card">' +
'        <h2>🌍 通用网站代理</h2>' +
'        <p style="color: var(--text-muted); margin-bottom: 1rem;">' +
'          输入任意网站 URL，通过代理访问。支持 HTML 页面、API、静态资源等。' +
'        </p>' +
'        <div class="warning-box">' +
'          <p>⚠️ <strong>注意：</strong>部分网站可能有反代理机制（如 Cloudflare 5秒盾、CSP 等），代理可能无法完全正常工作。</p>' +
'        </div>' +
'        <div class="input-group">' +
'          <input type="text" id="genericUrl" placeholder="https://example.com 或 example.com/path" style="flex: 3;">' +
'          <button onclick="goToGeneric()">🚀 访问</button>' +
'          <button class="secondary" onclick="copyGenericUrl()">📋 复制</button>' +
'        </div>' +
'        <div class="url-display" id="genericUrlDisplay">' +
'          <span id="genericGeneratedUrl">' + domain + '/proxy/example.com</span>' +
'          <button class="copy-btn secondary" onclick="copyGenericGenerated()">复制</button>' +
'        </div>' +
'        ' +
'        <h3 style="margin: 1.5rem 0 0.5rem; font-size: 1rem;">使用方式：</h3>' +
'        <div class="code-block">' +
'<span class="comment"># 方式1：路径形式</span>
' +
'' + domain + '/proxy/example.com
' +
'' + domain + '/proxy/example.com/path/to/page
' +
'
' +
'<span class="comment"># 方式2：查询参数形式</span>
' +
'' + domain + '/proxy/?target=https://example.com
' +
'' + domain + '/?target=https://example.com
' +
'
' +
'<span class="comment"># 方式3：API 调用</span>
' +
'curl ' + domain + '/proxy/api.github.com/users/octocat' +
'        </div>' +
'      </div>' +
'    </div>' +
'' +
'    <div id="hf-panel" class="section">' +
'      <div class="card">' +
'        <h2>🚀 快速访问 Hugging Face</h2>' +
'        <div class="input-group">' +
'          <select id="resourceType">' +
'            <option value="models">模型 (models)</option>' +
'            <option value="datasets">数据集 (datasets)</option>' +
'            <option value="spaces">Spaces</option>' +
'          </select>' +
'          <input type="text" id="resourcePath" placeholder="例如: bert-base-chinese 或 microsoft/DialoGPT-medium">' +
'        </div>' +
'        <div class="input-group">' +
'          <button onclick="goToResource()">🚀 访问</button>' +
'          <button class="secondary" onclick="copyUrl()">📋 复制链接</button>' +
'        </div>' +
'        <div class="url-display" id="urlDisplay">' +
'          <span id="generatedUrl">' + domain + '/models/bert-base-chinese</span>' +
'          <button class="copy-btn secondary" onclick="copyGeneratedUrl()">复制</button>' +
'        </div>' +
'      </div>' +
'' +
'      <div class="card">' +
'        <h2>🔐 登录 / 注册</h2>' +
'        <div class="input-group">' +
'          <button class="info" onclick="window.open('' + domain + '/login', '_blank')">🔑 登录</button>' +
'          <button class="info" onclick="window.open('' + domain + '/join', '_blank')">✨ 注册</button>' +
'          <button class="secondary" onclick="window.open('' + domain + '/settings/profile', '_blank')">⚙️ 设置</button>' +
'        </div>' +
'      </div>' +
'' +
'      <div class="card">' +
'        <h2>🎨 Gradio Space 代理</h2>' +
'        <div class="input-group">' +
'          <input type="text" id="spacePath" placeholder="username/space-name" style="flex: 1;">' +
'          <button class="gradio" onclick="goToSpace()">🚀 访问 Space</button>' +
'        </div>' +
'        <div class="url-display">' +
'          <span id="spaceUrl">' + domain + '/spaces/username/space-name</span>' +
'          <button class="copy-btn secondary" onclick="copySpaceUrl()">复制</button>' +
'        </div>' +
'      </div>' +
'' +
'      <div class="card">' +
'        <h2>💻 使用示例</h2>' +
'        <div class="tabs">' +
'          <button class="tab active" onclick="switchTab('python')">Python</button>' +
'          <button class="tab" onclick="switchTab('curl')">cURL</button>' +
'          <button class="tab" onclick="switchTab('js')">JavaScript</button>' +
'          <button class="tab" onclick="switchTab('git')">Git</button>' +
'          <button class="tab" onclick="switchTab('gradio')">Gradio</button>' +
'        </div>' +
'        <div id="python" class="tab-content active">' +
'          <div class="code-block">' +
'<span class="comment"># 使用 transformers</span>
' +
'<span class="keyword">from</span> transformers <span class="keyword">import</span> AutoModel
' +
'<span class="keyword">import</span> os
' +
'os.environ[<span class="string">"HF_ENDPOINT"</span>] = <span class="string">"' + domain + '"</span>
' +
'model = AutoModel.from_pretrained(<span class="string">"bert-base-chinese"</span>)' +
'          </div>' +
'        </div>' +
'        <div id="curl" class="tab-content">' +
'          <div class="code-block">' +
'<span class="comment"># 下载模型</span>
' +
'curl -L <span class="string">"' + domain + '/bert-base-chinese/resolve/main/config.json"</span>
' +
'
' +
'<span class="comment"># 通用代理</span>
' +
'curl -L <span class="string">"' + domain + '/proxy/api.github.com"</span>' +
'          </div>' +
'        </div>' +
'        <div id="js" class="tab-content">' +
'          <div class="code-block">' +
'<span class="comment">// 调用推理 API</span>
' +
'<span class="keyword">const</span> res = <span class="keyword">await</span> fetch(<span class="string">'' + domain + '/pipeline/sentiment-analysis/...'</span>, {
' +
'  method: <span class="string">'POST'</span>,
' +
'  headers: { <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span> },
' +
'  body: <span class="string">JSON.stringify({ inputs: "Hello!" })</span>
' +
'});' +
'          </div>' +
'        </div>' +
'        <div id="git" class="tab-content">' +
'          <div class="code-block">' +
'<span class="keyword">export</span> HF_ENDPOINT=' + domain + '
' +
'git clone ' + domain + '/bert-base-chinese' +
'          </div>' +
'        </div>' +
'        <div id="gradio" class="tab-content">' +
'          <div class="code-block">' +
'<span class="keyword">from</span> gradio_client <span class="keyword">import</span> Client
' +
'<span class="keyword">import</span> os
' +
'os.environ[<span class="string">"HF_ENDPOINT"</span>] = <span class="string">"' + domain + '"</span>
' +
'client = Client(<span class="string">"username/space-name"</span>)' +
'          </div>' +
'        </div>' +
'      </div>' +
'    </div>' +
'' +
'    <div class="grid">' +
'      <div class="feature-card">' +
'        <div class="feature-icon">🌍</div>' +
'        <h3>通用代理 <span class="badge badge-v5">NEW</span></h3>' +
'        <p>支持代理任意网站，自动重写页面中的链接，保持浏览连贯性。</p>' +
'      </div>' +
'      <div class="feature-card">' +
'        <div class="feature-icon">⚡</div>' +
'        <h3>HF 加速下载</h3>' +
'        <p>通过 Cloudflare CDN 加速模型和数据集下载。</p>' +
'      </div>' +
'      <div class="feature-card">' +
'        <div class="feature-icon">🎨</div>' +
'        <h3>Gradio Space 代理</h3>' +
'        <p>支持 WebSocket、SSE 流式传输和文件上传。</p>' +
'      </div>' +
'      <div class="feature-card">' +
'        <div class="feature-icon">🔐</div>' +
'        <h3>登录 / OAuth</h3>' +
'        <p>完整支持 HF 登录、注册、OAuth 授权流程。</p>' +
'      </div>' +
'      <div class="feature-card">' +
'        <div class="feature-icon">🍪</div>' +
'        <h3>Cookie 重写</h3>' +
'        <p>自动重写 Set-Cookie 中的 Domain 属性。</p>' +
'      </div>' +
'      <div class="feature-card">' +
'        <div class="feature-icon">🔗</div>' +
'        <h3>智能重定向</h3>' +
'        <p>POST 302→303 转换，防止"重新发送数据"弹窗。</p>' +
'      </div>' +
'    </div>' +
'  </div>' +
'' +
'  <footer>' +
'    <p>Made with ❤️ | 基于 Cloudflare Workers 构建</p>' +
'    <p style="margin-top: 0.5rem; font-size: 0.9rem;">仅供学习和研究使用</p>' +
'  </footer>' +
'' +
'  <div class="toast" id="toast">已复制到剪贴板！</div>' +
'' +
'  <script>' +
'    const domain = window.location.origin;' +
'    ' +
'    function switchMode(mode) {' +
'      document.querySelectorAll(".mode-btn").forEach(function(b) { b.classList.remove("active"); });' +
'      document.querySelectorAll(".section").forEach(function(s) { s.classList.remove("active"); });' +
'      event.target.classList.add("active");' +
'      document.getElementById(mode + "-panel").classList.add("active");' +
'    }' +
'    ' +
'    function updateGenericUrl() {' +
'      var url = document.getElementById("genericUrl").value.trim() || "example.com";' +
'      var cleanUrl = url.replace(/^https?:\/\//, "");' +
'      document.getElementById("genericGeneratedUrl").textContent = domain + "/proxy/" + cleanUrl;' +
'    }' +
'    function goToGeneric() {' +
'      var url = document.getElementById("genericUrl").value.trim();' +
'      if (!url) { showToast("请输入目标 URL"); return; }' +
'      var cleanUrl = url.replace(/^https?:\/\//, "");' +
'      window.open(domain + "/proxy/" + cleanUrl, "_blank");' +
'    }' +
'    function copyGenericUrl() {' +
'      var url = document.getElementById("genericUrl").value.trim() || "example.com";' +
'      var cleanUrl = url.replace(/^https?:\/\//, "");' +
'      navigator.clipboard.writeText(domain + "/proxy/" + cleanUrl);' +
'      showToast("链接已复制！");' +
'    }' +
'    function copyGenericGenerated() {' +
'      navigator.clipboard.writeText(document.getElementById("genericGeneratedUrl").textContent);' +
'      showToast("链接已复制！");' +
'    }' +
'    ' +
'    function updateUrl() {' +
'      var type = document.getElementById("resourceType").value;' +
'      var path = document.getElementById("resourcePath").value.trim() || "bert-base-chinese";' +
'      document.getElementById("generatedUrl").textContent = domain + "/" + type + "/" + path;' +
'    }' +
'    function updateSpaceUrl() {' +
'      var path = document.getElementById("spacePath").value.trim() || "username/space-name";' +
'      document.getElementById("spaceUrl").textContent = domain + "/spaces/" + path;' +
'    }' +
'    function goToResource() {' +
'      var type = document.getElementById("resourceType").value;' +
'      var path = document.getElementById("resourcePath").value.trim();' +
'      if (!path) { showToast("请输入资源路径"); return; }' +
'      window.open(domain + "/" + type + "/" + path, "_blank");' +
'    }' +
'    function goToSpace() {' +
'      var path = document.getElementById("spacePath").value.trim();' +
'      if (!path) { showToast("请输入 Space 路径"); return; }' +
'      window.open(domain + "/spaces/" + path, "_blank");' +
'    }' +
'    function copyUrl() {' +
'      var type = document.getElementById("resourceType").value;' +
'      var path = document.getElementById("resourcePath").value.trim() || "bert-base-chinese";' +
'      navigator.clipboard.writeText(domain + "/" + type + "/" + path);' +
'      showToast("链接已复制！");' +
'    }' +
'    function copySpaceUrl() {' +
'      var path = document.getElementById("spacePath").value.trim() || "username/space-name";' +
'      navigator.clipboard.writeText(domain + "/spaces/" + path);' +
'      showToast("Space 链接已复制！");' +
'    }' +
'    function copyGeneratedUrl() {' +
'      navigator.clipboard.writeText(document.getElementById("generatedUrl").textContent);' +
'      showToast("链接已复制！");' +
'    }' +
'    function showToast(msg) {' +
'      var t = document.getElementById("toast");' +
'      t.textContent = msg; t.classList.add("show");' +
'      setTimeout(function() { t.classList.remove("show"); }, 2000);' +
'    }' +
'    function switchTab(name) {' +
'      document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });' +
'      document.querySelectorAll(".tab-content").forEach(function(t) { t.classList.remove("active"); });' +
'      event.target.classList.add("active");' +
'      document.getElementById(name).classList.add("active");' +
'    }' +
'    ' +
'    document.getElementById("genericUrl").addEventListener("input", updateGenericUrl);' +
'    document.getElementById("resourceType").addEventListener("change", updateUrl);' +
'    document.getElementById("resourcePath").addEventListener("input", updateUrl);' +
'    document.getElementById("spacePath").addEventListener("input", updateSpaceUrl);' +
'    ' +
'    fetch("/health").then(function(r) { return r.json(); }).then(function() {' +
'      document.getElementById("statusText").textContent = "服务运行中";' +
'    }).catch(function() {' +
'      document.getElementById("statusText").textContent = "服务异常";' +
'      document.querySelector(".status-dot").style.background = "var(--error)";' +
'    });' +
'    ' +
'    updateGenericUrl(); updateUrl(); updateSpaceUrl();' +
'  </script>' +
'</body>' +
'</html>';

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      ...getCorsHeaders('*'),
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      return serveFrontend(url.hostname);
    }

    return handleRequest(request, env);
  },
};
