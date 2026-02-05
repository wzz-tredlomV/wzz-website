import bcrypt from 'bcryptjs'
import { Resend } from 'resend'

const resend = new Resend('re_你的key')
// 常见公共邮箱白名单
const ALLOWED_DOMAINS = [
  'gmail.com','outlook.com','hotmail.com','qq.com','163.com','126.com','sina.com','yahoo.com','foxmail.com'
]

function isAllowedEmail(email) {
  const domain = email.toLowerCase().split('@')[1]
  return ALLOWED_DOMAINS.includes(domain)
}

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>CF Auth</title>
  <style>body{font-family:system-ui,max-width:380px;margin:60px auto;padding:20px}</style></head>
  <body>${body}</body></html>`
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    // 首页：注册 + 登录 两个表单
    if (url.pathname === '/' && req.method === 'GET') {
      return new Response(html(`
        <h2>注册</h2>
        <form method="post" action="/register">
          <input name="email" type="email" placeholder="邮箱" required><br>
          <input name="password" type="password" placeholder="密码" minlength="6" required><br>
          <button>注册</button>
        </form>
        <h2>登录</h2>
        <form method="post" action="/login">
          <input name="email" type="email" placeholder="邮箱" required><br>
          <input name="password" type="password" placeholder="密码" required><br>
          <button>登录</button>
        </form>
      `), { headers: { 'Content-Type': 'text/html;charset=utf-8' } })
    }

    // 注册
    if (url.pathname === '/register' && req.method === 'POST') {
      const form = await req.formData()
      const email = form.get('email').trim()
      const pwd = form.get('password')
      if (!isAllowedEmail(email)) return new Response('仅支持常见公共邮箱', { status: 400 })
      const exist = await env.USERS_KV.get(`user:${email}`)
      if (exist) return new Response('该邮箱已注册', { status: 400 })
      const hashed = await bcrypt.hash(pwd, 10)
      await env.USERS_KV.put(`user:${email}`, JSON.stringify({ hashed, verified: false }))
      // 发验证信（最简版）
      await resend.emails.send({
        from: 'noreply@你的workers.dev子域',
        to: email,
        subject: '请验证邮箱',
        html: `<a href="https://${req.headers.get('host')}/verify?email=${email}">点击验证</a>`
      })
      return new Response('注册成功，请查收验证邮件')
    }

    // 邮箱验证
    if (url.pathname === '/verify' && req.method === 'GET') {
      const email = url.searchParams.get('email')
      const raw = await env.USERS_KV.get(`user:${email}`)
      if (!raw) return new Response('用户不存在')
      const u = JSON.parse(raw)
      u.verified = true
      await env.USERS_KV.put(`user:${email}`, JSON.stringify(u))
      return new Response('验证完成，现在可登录')
    }

    // 登录
    if (url.pathname === '/login' && req.method === 'POST') {
      const form = await req.formData()
      const email = form.get('email').trim()
      const pwd = form.get('password')
      const raw = await env.USERS_KV.get(`user:${email}`)
      if (!raw) return new Response('用户不存在或未验证', { status: 401 })
      const u = JSON.parse(raw)
      if (!u.verified) return new Response('请先验证邮箱', { status: 401 })
      const ok = await bcrypt.compare(pwd, u.hashed)
      if (!ok) return new Response('密码错误', { status: 401 })
      return new Response('登录成功！欢迎 ' + email)
    }

    return new Response('Not Found', { status: 404 })
  }
}

