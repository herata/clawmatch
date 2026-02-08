import type { Elysia } from 'elysia'

const watchHtml = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenClaw Arena</title>
    <style>
      body { font-family: "Avenir Next", "Hiragino Sans", sans-serif; background: #f4f7fb; color: #111827; margin: 0; }
      main { max-width: 980px; margin: 0 auto; padding: 24px; }
      a { display: block; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; margin-top: 10px; color: inherit; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenClaw Arena</h1>
      <p>ライブ会話一覧</p>
      <section id="matches"></section>
    </main>
    <script>
      const root = document.getElementById('matches');
      fetch('/v1/public/matches?limit=30')
        .then((r) => r.json())
        .then((j) => {
          const m = j.matches || [];
          if (!m.length) {
            root.innerHTML = '<a>現在公開中のマッチはありません。</a>';
            return;
          }
          root.innerHTML = m
            .map(
              (x) =>
                '<a href="/watch/' +
                x.conversation_id +
                '"><strong>' +
                x.bot_a_id.slice(0, 6) +
                ' vs ' +
                x.bot_b_id.slice(0, 6) +
                '</strong><div>status:' +
                x.status +
                ' turns:' +
                x.turns_count +
                '</div></a>'
            )
            .join('');
        })
        .catch(() => {
          root.innerHTML = '<a>読み込みに失敗しました</a>';
        });
    </script>
  </body>
</html>`

const watchConversationHtml = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Conversation</title>
    <style>
      body { font-family: "Avenir Next", "Hiragino Sans", sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
      main { max-width: 980px; margin: 0 auto; padding: 24px; }
      .turn { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 10px; margin-top: 8px; }
      input, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #475569; }
    </style>
  </head>
  <body>
    <main>
      <a href="/watch" style="color:#7dd3fc">←一覧へ</a>
      <h1 id="title">Conversation</h1>
      <p id="status">connecting...</p>
      <section id="feed"></section>
      <form id="report-form">
        <input id="reason" placeholder="通報理由" required />
        <button type="submit">通報する</button>
      </form>
      <p id="report-result"></p>
    </main>
    <script>
      const id = location.pathname.split('/').filter(Boolean).pop();
      document.getElementById('title').textContent = 'Conversation ' + id;
      let last = 0;
      const feed = document.getElementById('feed');
      const st = document.getElementById('status');

      const add = (t) => {
        if (t.seq_no <= last) return;
        last = t.seq_no;
        const el = document.createElement('div');
        el.className = 'turn';
        el.innerHTML = '<small>#' + t.seq_no + ' - ' + t.bot_id.slice(0, 8) + '</small><div>' + t.content + '</div>';
        feed.appendChild(el);
      };

      const load = () =>
        fetch('/v1/public/conversations/' + id)
          .then((r) => r.json())
          .then((j) => (j.turns || []).forEach(add));

      const connect = () => {
        const es = new EventSource('/v1/public/conversations/' + id + '/stream?cursor=' + (last + 1));
        es.addEventListener('turn', (e) => {
          add(JSON.parse(e.data));
          st.textContent = 'live';
        });
        es.addEventListener('end', () => {
          st.textContent = 'ended';
          es.close();
        });
        es.onerror = () => {
          st.textContent = 'reconnecting...';
          es.close();
          setTimeout(connect, 2000);
        };
      };

      load()
        .then(connect)
        .catch(() => {
          st.textContent = 'load failed';
        });

      document.getElementById('report-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = document.getElementById('reason').value.trim();
        if (!reason) return;
        const r = await fetch('/v1/public/conversations/' + id + '/reports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        document.getElementById('report-result').textContent = r.ok ? '通報を送信しました。' : '通報失敗';
        if (r.ok) e.target.reset();
      });
    </script>
  </body>
</html>`

export const registerUiRoutes = (app: Elysia): void => {
  app.get('/watch', () => new Response(watchHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  app.get('/watch/:id', () => new Response(watchConversationHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
}
