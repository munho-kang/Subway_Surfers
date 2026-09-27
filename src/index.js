// 게임 화면은 public/ 의 정적 파일로 나간다. 여기선 랭킹 API 와 관리자 페이지만 처리한다
const NICKNAME_MAX = 12;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/scores/') return await scores(request, env);
      if (url.pathname === '/admin' || url.pathname === '/admin/') return await admin(request, env, url);
    } catch (err) {
      // 랭킹은 부가 기능이다. DB 실패를 응답으로 바꾸고 게임은 계속 돌게 한다
      console.error(err);
      return Response.json({ error: '랭킹 서버에 문제가 있습니다' }, { status: 503 });
    }
    return new Response('Not found', { status: 404 });
  },
};

async function scores(request, env) {
  if (request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT nickname, score FROM scores ORDER BY score DESC, id LIMIT 10')
      .all();
    return Response.json({ scores: results });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('잘못된 요청입니다');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return badRequest('잘못된 요청입니다');
  }

  const nickname = String(payload.nickname ?? '').trim();
  const length = [...nickname].length; // 이모지를 한 글자로 센다
  if (length < 1 || length > NICKNAME_MAX) {
    return badRequest(`닉네임은 1~${NICKNAME_MAX}자여야 합니다`);
  }
  // true/false 와 소수, 음수를 거른다
  if (!Number.isSafeInteger(payload.score) || payload.score < 0) {
    return badRequest('점수가 올바르지 않습니다');
  }

  const playedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  await env.DB
    .prepare('INSERT INTO scores (nickname, score, played_at) VALUES (?, ?, ?)')
    .bind(nickname, payload.score, playedAt)
    .run();
  return Response.json({ ok: true });
}

async function admin(request, env, url) {
  if (!isAdmin(request, env)) {
    // 브라우저가 아이디/비밀번호 입력 창을 띄운다
    return new Response('관리자 로그인이 필요합니다', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="admin", charset="UTF-8"' },
    });
  }

  if (request.method === 'POST') {
    // 로그인 정보는 브라우저가 알아서 붙인다. 다른 사이트가 몰래 보낸 삭제 요청은 거절한다
    if (request.headers.get('Origin') !== url.origin) {
      return new Response('잘못된 요청입니다', { status: 403 });
    }
    const id = Number((await request.formData()).get('id'));
    await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(id).run();
    return Response.redirect(`${url.origin}/admin`, 303);
  }

  // ponytail: 전체 기록을 한 번에 보여준다. 수천 건이 넘어가면 페이지 나누기를 붙인다
  const { results } = await env.DB
    .prepare('SELECT id, nickname, score, played_at FROM scores ORDER BY score DESC, id')
    .all();
  return new Response(adminPage(results), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function isAdmin(request, env) {
  // 비밀번호가 설정되지 않았으면 아무도 못 들어온다
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  try {
    return atob(header.slice(6)) === `${env.ADMIN_USER}:${env.ADMIN_PASSWORD}`;
  } catch {
    return false;
  }
}

function badRequest(message) {
  return Response.json({ error: message }, { status: 400 });
}

// 닉네임은 누구나 넣을 수 있다. 그대로 HTML 에 넣으면 관리자 화면에서 스크립트가 돈다
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function adminPage(rows) {
  const body = rows.length
    ? rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(r.nickname)}</td>
        <td class="num">${r.score}</td>
        <td>${escapeHtml(r.played_at)}</td>
        <td>
          <form method="post" onsubmit="return confirm('이 기록을 삭제할까요?')">
            <input type="hidden" name="id" value="${r.id}">
            <button>삭제</button>
          </form>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="5">기록이 없습니다</td></tr>';

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>랭킹 관리</title>
  <style>
    body { margin: 0; padding: 24px 16px; background: #0b0d17; color: #e8ecff; font-family: system-ui, sans-serif; }
    main { max-width: 720px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #262b45; text-align: left; }
    th { color: #8a93b8; font-weight: 500; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    form { margin: 0; }
    button { padding: 6px 12px; border: 1px solid #ff4d6d; border-radius: 6px; background: transparent; color: #ff4d6d; cursor: pointer; }
    button:hover { background: #ff4d6d; color: #0b0d17; }
  </style>
</head>
<body>
  <main>
    <h1>랭킹 관리</h1>
    <p>총 ${rows.length}개 기록</p>
    <table>
      <thead><tr><th>순위</th><th>닉네임</th><th class="num">점수</th><th>기록 시각</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </main>
</body>
</html>`;
}
