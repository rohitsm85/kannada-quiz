// Plays a whole game with a fake host and two fake students. Run: npm test
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('./server');

const once = (s, ev) => new Promise((r) => s.once(ev, r));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));

server.listen(0, async () => {
  const url = `http://localhost:${server.address().port}`;
  const conn = () => new Promise((r) => { const s = io(url, { forceNew: true }); s.on('connect', () => r(s)); });
  const [host, ana, ben] = [await conn(), await conn(), await conn()];

  const quiz = { title: 'ಪರೀಕ್ಷೆ', questions: [
    { text: 'ಆಮೆ means Mother', options: ['True', 'False'], correct: 1, time: 10 },
    { text: 'Tree?', options: ['ಮರ', 'ಮಾರ', 'ಮರಾ', 'ಮಾರಾ'], correct: 0, time: 10 },
  ] };

  // Bad input is rejected at the door.
  assert.strictEqual((await call(host, 'host:create', { title: 'x', questions: [] })).ok, false);
  const { pin } = await call(host, 'host:create', quiz);
  assert.match(pin, /^\d{6}$/);
  assert.strictEqual((await call(ana, 'join', { pin: '000000', name: 'Ana' })).ok, false);
  assert.strictEqual((await call(ana, 'join', { pin, name: '   ' })).ok, false);
  assert.ok((await call(ana, 'join', { pin, name: 'Ana' })).ok);
  assert.strictEqual((await call(ben, 'join', { pin, name: 'ana' })).ok, false, 'duplicate name, any case');
  const b = await call(ben, 'join', { pin, name: 'Ben' });
  assert.ok(b.ok);

  // Question 1: Ana right, Ben wrong. It ends early once both have answered.
  const qs = [once(ana, 'question'), once(ben, 'question'), once(host, 'question')];
  host.emit('host:next');
  const [q1] = await Promise.all(qs);
  assert.strictEqual(q1.text, 'ಆಮೆ means Mother');
  assert.ok(!('correct' in q1), 'the answer is not sent to students');
  const res = [once(ana, 'result'), once(ben, 'result'), once(host, 'results')];
  ana.emit('answer', 1);
  ana.emit('answer', 0); // a second answer is ignored
  ben.emit('answer', 0);
  const [resA, resB, resH] = await Promise.all(res);
  assert.ok(resA.correct && resA.points >= 500 && resA.points <= 1000);
  assert.strictEqual(resA.streak, 1); assert.strictEqual(resA.bonus, 0);
  assert.ok(!resB.correct && resB.points === 0 && resB.correctText === 'False');
  assert.deepStrictEqual(resH.counts, [1, 1]);
  assert.strictEqual(resH.leaderboard[0].name, 'Ana');
  assert.strictEqual(resH.isLast, false);

  // Ben's phone locks and reconnects: same player, same result screen.
  ben.close();
  const ben2 = await conn();
  const again = once(ben2, 'result');
  assert.ok((await call(ben2, 'rejoin', { pin, token: b.token })).ok);
  assert.deepStrictEqual(await again, resB);

  // Question 2: Ana answers (an out-of-range answer is ignored), Ben does not, host skips.
  const q2 = [once(ana, 'question'), once(ben2, 'question')];
  host.emit('host:next');
  await Promise.all(q2);
  const res2 = [once(ana, 'result'), once(ben2, 'result'), once(host, 'results')];
  ana.emit('answer', 7);
  ana.emit('answer', 0);
  await once(host, 'answered');
  host.emit('host:skip');
  const [r2a, r2b, r2h] = await Promise.all(res2);
  assert.ok(r2a.correct);
  assert.strictEqual(r2a.streak, 2); assert.strictEqual(r2a.bonus, 100); // second right answer in a row
  assert.strictEqual(r2b.streak, 0);
  assert.strictEqual(r2b.answered, false);
  assert.strictEqual(r2h.isLast, true);

  // Last Next ends the game with a leaderboard.
  const ends = [once(host, 'end'), once(ana, 'end')];
  host.emit('host:next');
  const [end, endA] = await Promise.all(ends);
  assert.strictEqual(end.leaderboard[0].name, 'Ana');
  assert.strictEqual(endA.rank, 1);

  console.log('All checks passed');
  process.exit(0);
});
