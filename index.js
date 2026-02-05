export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 处理 API 请求
    if (path.startsWith('/api/')) {
      return handleAPI(request, env, path);
    }

    // 返回主页
    return new Response(HTML_TEMPLATE, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
};

// 支持的知名邮箱域名白名单
const ALLOWED_EMAIL_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'qq.com',
  '163.com',
  '126.com',
  'foxmail.com',
  'sina.com',
  'sohu.com',
  'aliyun.com'
];

// HTML 模板
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>个人空间</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 400px;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }
        .tabs {
            display: flex;
            margin-bottom: 30px;
            border-bottom: 2px solid #eee;
        }
        .tab {
            flex: 1;
            padding: 15px;
            text-align: center;
            cursor: pointer;
            color: #999;
            transition: all 0.3s;
        }
        .tab.active {
            color: #667eea;
            border-bottom: 2px solid #667eea;
            margin-bottom: -2px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-size: 14px;
        }
        input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .message {
            margin-top: 15px;
            padding: 12px;
            border-radius: 8px;
            text-align: center;
            display: none;
        }
        .message.error {
            background: #fee;
            color: #c33;
            display: block;
        }
        .message.success {
            background: #efe;
            color: #3c3;
            display: block;
        }
        .email-hint {
            font-size: 12px;
            color: #888;
            margin-top: 5px;
        }
        .protected-content {
            text-align: center;
        }
        .protected-content h2 {
            color: #667eea;
            margin-bottom: 20px;
        }
        .logout-btn {
            margin-top: 20px;
            background: #ff6b6b;
        }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="container" id="authContainer">
        <h1>🚀 个人空间</h1>

        <div class="tabs">
            <div class="tab active" onclick="switchTab('login')">登录</div>
            <div class="tab" onclick="switchTab('register')">注册</div>
        </div>

        <!-- 登录表单 -->
        <form id="loginForm" class="auth-form">
            <div class="form-group">
                <label>邮箱</label>
                <input type="email" id="loginEmail" required placeholder="your@email.com">
                <div class="email-hint">支持: Gmail, Outlook, QQ, 163等主流邮箱</div>
            </div>
            <div class="form-group">
                <label>密码</label>
                <input type="password" id="loginPassword" required placeholder="至少6位字符">
            </div>
            <button type="submit" id="loginBtn">登录</button>
            <div id="loginMessage" class="message"></div>
        </form>

        <!-- 注册表单 -->
        <form id="registerForm" class="auth-form hidden">
            <div class="form-group">
                <label>邮箱</label>
                <input type="email" id="regEmail" required placeholder="your@email.com">
                <div class="email-hint">支持: Gmail, Outlook, QQ, 163等主流邮箱</div>
            </div>
            <div class="form-group">
                <label>密码</label>
                <input type="password" id="regPassword" required placeholder="至少6位字符">
            </div>
            <div class="form-group">
                <label>确认密码</label>
                <input type="password" id="regConfirmPassword" required placeholder="再次输入密码">
            </div>
            <button type="submit" id="regBtn">注册</button>
            <div id="regMessage" class="message"></div>
        </form>
    </div>

    <!-- 登录后的内容 -->
    <div class="container hidden" id="protectedContainer">
        <div class="protected-content">
            <h2>🎉 欢迎回来！</h2>
            <p>您已成功登录个人空间</p>
            <p style="color: #666; margin-top: 10px;" id="userEmail"></p>
            <button class="logout-btn" onclick="logout()">退出登录</button>
        </div>
    </div>

    <script>
        // 切换标签页
        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');

            if (tab === 'login') {
                document.getElementById('loginForm').classList.remove('hidden');
                document.getElementById('registerForm').classList.add('hidden');
            } else {
                document.getElementById('loginForm').classList.add('hidden');
                document.getElementById('registerForm').classList.remove('hidden');
            }
        }

        // 显示消息
        function showMessage(elementId, message, isError = true) {
            const el = document.getElementById(elementId);
            el.textContent = message;
            el.className = 'message ' + (isError ? 'error' : 'success');
        }

        // 登录
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('loginBtn');
            btn.disabled = true;

            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: document.getElementById('loginEmail').value,
                    password: document.getElementById('loginPassword').value
                })
            });

            const data = await res.json();
            btn.disabled = false;

            if (data.success) {
                showMessage('loginMessage', '登录成功！', false);
                setTimeout(() => showProtected(data.email), 500);
            } else {
                showMessage('loginMessage', data.error || '登录失败');
            }
        });

        // 注册
        document.getElementById('registerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('regBtn');
            btn.disabled = true;

            const password = document.getElementById('regPassword').value;
            const confirm = document.getElementById('regConfirmPassword').value;

            if (password !== confirm) {
                showMessage('regMessage', '两次密码不一致');
                btn.disabled = false;
                return;
            }

            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: document.getElementById('regEmail').value,
                    password: password
                })
            });

            const data = await res.json();
            btn.disabled = false;

            if (data.success) {
                showMessage('regMessage', '注册成功！请登录', false);
                setTimeout(() => switchTab('login'), 1000);
            } else {
                showMessage('regMessage', data.error || '注册失败');
            }
        });

        // 显示受保护内容
        function showProtected(email) {
            document.getElementById('authContainer').classList.add('hidden');
            document.getElementById('protectedContainer').classList.remove('hidden');
            document.getElementById('userEmail').textContent = email;
        }

        // 退出登录
        async function logout() {
            await fetch('/api/logout', { method: 'POST' });
            location.reload();
        }

        // 检查登录状态
        async function checkAuth() {
            const res = await fetch('/api/me');
            const data = await res.json();
            if (data.authenticated) {
                showProtected(data.email);
            }
        }
        checkAuth();
    </script>
</body>
