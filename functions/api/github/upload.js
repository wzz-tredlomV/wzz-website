export async function onRequest(context) {
    const { request } = context;
    
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { repo, token, path, content, message, branch = 'main' } = await request.json();

        // 检查文件是否存在（用于获取sha）
        const checkUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
        const checkResponse = await fetch(checkUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        let sha = null;
        if (checkResponse.ok) {
            const existing = await checkResponse.json();
            sha = existing.sha;
        }

        // 上传/更新文件
        const uploadResponse = await fetch(checkUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message || `Upload ${path}`,
                content: content,
                sha: sha,
                branch: branch
            })
        });

        const result = await uploadResponse.json();

        if (!uploadResponse.ok) {
            return new Response(JSON.stringify({ 
                error: result.message || '上传失败' 
            }), { 
                status: uploadResponse.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ 
            success: true, 
            path: path
        }), {
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
