// 랭킹 API 와 관리자 페이지 테스트. D1 대신 Node 내장 SQLite 로 흉내 낸다
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const ORIGIN = 'https://game.example';
const AUTH = 'Basic ' + btoa('admin:secret');

function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  // D1 의 prepare().bind().all()/run() 모양만 맞춘다
  const DB = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind: (...a) => ((args = a), stmt),
        all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
        run: async () => db.prepare(sql).run(...args),
      };
      return stmt;
    },
  };
  return { DB, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'secret', sqlite: db };
}

const call = (env, path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env);
const post = (env, body) =>
  call(env, '/api/scores/', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
const count = (env) => env.sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get().n;

test('상위 10개를 점수 내림차순으로 준다', async () => {
  const env = makeEnv();
  for (let i = 0; i < 15; i++) await post(env, JSON.stringify({ nickname: `p${i}`, score: i * 10 }));
  const { scores } = await (await call(env, '/api/scores/')).json();
  assert.deepEqual(scores.map((s) => s.score), [140, 130, 120, 110, 100, 90, 80, 70, 60, 50]);
  assert.equal(scores[0].nickname, 'p14');
});

test('점수를 저장한다', async () => {
  const env = makeEnv();
  const res = await post(env, JSON.stringify({ nickname: ' 홍길동 ', score: 320 }));
  assert.equal(res.status, 200);
  const row = env.sqlite.prepare('SELECT * FROM scores').get();
  assert.equal(row.nickname, '홍길동');
  assert.equal(row.score, 320);
  assert.match(row.played_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('잘못된 요청은 400 이고 저장하지 않는다', async () => {
  const env = makeEnv();
  const bad = [
    JSON.stringify({ nickname: 'a'.repeat(13), score: 10 }),
    JSON.stringify({ nickname: '', score: 10 }),
    JSON.stringify({ nickname: 'abc', score: true }),
    JSON.stringify({ nickname: 'abc', score: 1.5 }),
    JSON.stringify({ nickname: 'abc', score: -1 }),
    'null', '42', '"x"', '[1,2,3]', '{not json',
  ];
  for (const body of bad) assert.equal((await post(env, body)).status, 400, body);
  assert.equal(count(env), 0);
});

test('관리자 페이지는 로그인 없이, 틀린 비밀번호로, 비밀번호 미설정으로 못 들어간다', async () => {
  const env = makeEnv();
  assert.equal((await call(env, '/admin')).status, 401);
  const wrong = { headers: { Authorization: 'Basic ' + btoa('admin:nope') } };
  assert.equal((await call(env, '/admin', wrong)).status, 401);
  const unset = { ...env, ADMIN_USER: undefined, ADMIN_PASSWORD: undefined };
  const guess = { headers: { Authorization: 'Basic ' + btoa('undefined:undefined') } };
  assert.equal((await call(unset, '/admin', guess)).status, 401);
});

test('관리자는 기록을 보고 지울 수 있다', async () => {
  const env = makeEnv();
  await post(env, JSON.stringify({ nickname: '<script>x', score: 5 }));
  await post(env, JSON.stringify({ nickname: 'keep', score: 7 }));

  const html = await (await call(env, '/admin', { headers: { Authorization: AUTH } })).text();
  assert.ok(html.includes('&#60;script&#62;x'), '닉네임이 이스케이프돼야 한다');
  assert.ok(!html.includes('<script>x'));

  const id = env.sqlite.prepare("SELECT id FROM scores WHERE nickname = '<script>x'").get().id;
  const del = (origin) =>
    call(env, '/admin', { method: 'POST', body: new URLSearchParams({ id }), headers: { Authorization: AUTH, Origin: origin } });

  assert.equal((await del('https://evil.example')).status, 403);
  assert.equal(count(env), 2);

  const res = await del(ORIGIN);
  assert.equal(res.status, 303);
  assert.deepEqual(env.sqlite.prepare('SELECT nickname FROM scores').all().map((r) => r.nickname), ['keep']);
});

test('DB 가 죽어도 503 으로 답한다', async () => {
  const env = { DB: { prepare: () => { throw new Error('down'); } } };
  const res = await call(env, '/api/scores/');
  assert.equal(res.status, 503);
});
