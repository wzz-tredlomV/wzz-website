export default {
  async fetch(req, ctx) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const { email, password } = await req.json();
    if (!email || !password || password.length < 6)
      return Response.json({ message: '字段无效' }, { status: 400 });

    const { results } = await ctx.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? AND password = ?'
    ).bind(email, password).all();

    if (!results.length) return Response.json({ message: '账号或密码错误' }, { status: 401 });

    const token = await sign({ uid: results[0].id }, ctx.env.JWT_SECRET);
    return Response.json({ token });
  }
};
