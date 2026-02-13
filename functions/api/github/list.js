export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    
    const repo = url.searchParams.get('repo');
    const token = url.searchParams.get('token');
    const path = url.searchParams.get('path') || '';
    const branch = url.searchParams.get('branch') || 'main';

    if (!repo || !token) {
        return new Response(JSON.stringify({ error: '缺少参数' }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            // 如果目录不存在，返回空数组
            if (response.status === 404) {
                return new Response(JSON.stringify({ files: [] }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            const error = await response.json();
            return new Response(JSON.stringify({ 
                error: error.message || '获取失败' 
            }), { 
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const data = await response.json();
        
        // 过滤出文件（排除目录）
        const files = Array.isArray(data) 
            ? data.filter(item => item.type === 'file').map(item => ({
                name: item.name,
                path: item.path,
                size: item.size
            }))
            : [];

        return new Response(JSON.stringify({ files }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ 
            error: error.message 
        }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
