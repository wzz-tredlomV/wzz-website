export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({status: 'ok'}), {
        headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}
      });
    }
    
    let targetHost = 'huggingface.co';
    let targetPath = url.pathname;
    
    const spaceMatch = url.pathname.match(/^\/space\/([^\/]+)(.*)$/);
    if (spaceMatch) {
      targetHost = spaceMatch[1] + '.hf.space';
      targetPath = spaceMatch[2] || '/';
    }
    
    const targetUrl = `https://${targetHost}${targetPath}${url.search}`;
    
    const headers = new Headers(request.headers);
    headers.set('Host', targetHost);
    headers.delete('Origin');
    
    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
        redirect: 'manual',
      });
      
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({error: e.message}), {
        status: 502,
        headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
      });
    }
  }
};
