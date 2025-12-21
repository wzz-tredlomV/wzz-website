export default {
  async fetch(req, ctx) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const { email, password } = await req.json();
    if (!email || !password || password.length < 6)
      return Response.json({ message: '字段无效' }, { status: 400 });

    const exist = await ctx.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exist) return Response.json({ message: '邮箱已存在' }, { status: 409 });

    await ctx.env.DB.prepare('INSERT INTO users (email, password) VALUES (?, ?)')
      .bind(email, password).run();
    return Response.json({ message: '注册成功' });
  }
};
