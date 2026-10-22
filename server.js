const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(__dirname + '/public'));
app.get('/host', (req, res) => res.sendFile(__dirname + '/public/host.html'));
const server = http.createServer(app);
const io = new Server(server);

// shortcut: all games live in memory, a server restart ends them; add a database only if games must survive restarts
const games = new Map();
const MAX_PLAYERS = 100;

const token = () => crypto.randomBytes(12).toString('hex');
const newPin = () => {
  let p;
  do p = String(100000 + crypto.randomInt(900000)); while (games.has(p));
  return p;
};

// Validate the quiz at the trust boundary: it arrives from a browser.
function cleanQuiz(q) {
  if (!q || typeof q.title !== 'string' || !Array.isArray(q.questions)) return null;
  if (q.questions.length < 1 || q.questions.length > 100) return null;
  const questions = [];
  for (const x of q.questions) {
    if (!x || typeof x.text !== 'string' || !x.text.trim() || x.text.length > 300) return null;
    if (!Array.isArray(x.options) || x.options.length < 2 || x.options.length > 4) return null;
    if (x.options.some((o) => typeof o !== 'string' || !o.trim() || o.length > 120)) return null;
    if (!Number.isInteger(x.correct) || x.correct < 0 || x.correct >= x.options.length) return null;
    const time = [10, 20, 30, 60].includes(x.time) ? x.time : 20;
    questions.push({ text: x.text.trim(), options: x.options.map((o) => o.trim()), correct: x.correct, time });
  }
  return { title: q.title.trim().slice(0, 100), questions };
}

app.get('/qr.svg', async (req, res) => {
  const u = String(req.query.u || '').slice(0, 200);
  if (!/^https?:\/\//.test(u)) return res.status(400).end();
  res.type('image/svg+xml').send(await require('qrcode').toString(u, { type: 'svg', margin: 1 }));
});

const cleanName = (n) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim() : '');
const board = (g) =>
  [...g.players.values()].sort((a, b) => b.score - a.score).map((p) => ({ name: p.name, score: p.score, points: p.points, streak: p.streak }));
const questionPayload = (g, remaining) => {
  const q = g.quiz.questions[g.q];
  return { index: g.q, total: g.quiz.questions.length, text: q.text, options: q.options, time: q.time, remaining };
};
const remainingMs = (g) => Math.max(0, g.startedAt + g.quiz.questions[g.q].time * 1000 - Date.now());
const lobbyPayload = (g) => ({ title: g.quiz.title, players: [...g.players.values()].map((p) => p.name) });

function startQuestion(g) {
  g.q++;
  g.state = 'question';
  g.startedAt = Date.now();
  for (const p of g.players.values()) p.choice = null;
  const q = g.quiz.questions[g.q];
  io.to(g.pin).emit('question', questionPayload(g, q.time * 1000));
  io.to(g.host).emit('question', questionPayload(g, q.time * 1000));
  io.to(g.host).emit('answered', { count: 0, total: g.players.size });
  g.timer = setTimeout(() => endQuestion(g), q.time * 1000 + 300);
}

function endQuestion(g) {
  if (g.state !== 'question') return;
  clearTimeout(g.timer);
  g.state = 'results';
  const q = g.quiz.questions[g.q];
  const counts = q.options.map(() => 0);
  for (const p of g.players.values()) {
    p.correct = p.choice === q.correct;
    // faster correct answers earn more: 1000 down to 500 at the buzzer
    const base = p.correct ? Math.round(1000 * (1 - Math.min(1, p.elapsed / (q.time * 1000)) / 2)) : 0;
    // streak bonus: each extra right answer in a row adds 100, up to +500
    p.streak = p.correct ? p.streak + 1 : 0;
    p.bonus = p.correct ? Math.min(p.streak - 1, 5) * 100 : 0;
    p.points = base + p.bonus;
    p.score += p.points;
    if (p.choice !== null) counts[p.choice]++;
  }
  const lb = board(g);
  const rankOf = new Map(lb.map((r, i) => [r.name, i + 1]));
  for (const p of g.players.values()) {
    p.last = { correct: p.correct, answered: p.choice !== null, points: p.points, bonus: p.bonus, streak: p.streak, score: p.score, rank: rankOf.get(p.name), total: g.players.size, correctText: q.options[q.correct] };
    io.to(p.sid).emit('result', p.last);
  }
  g.lastResults = { text: q.text, options: q.options, correct: q.correct, counts, leaderboard: lb.slice(0, 5), isLast: g.q + 1 >= g.quiz.questions.length };
  io.to(g.host).emit('results', g.lastResults);
}

function endGame(g) {
  g.state = 'end';
  const lb = board(g);
  g.finalBoard = lb;
  io.to(g.host).emit('end', { leaderboard: lb.slice(0, 10) });
  for (const p of g.players.values()) {
    p.last = { score: p.score, rank: lb.findIndex((r) => r.name === p.name) + 1, total: g.players.size };
    io.to(p.sid).emit('end', p.last);
  }
}

io.on('connection', (socket) => {
  const hostGame = () => games.get(socket.data.hostPin);
  const playerOf = () => {
    const g = games.get(socket.data.pin);
    return g && { g, p: g.players.get(socket.data.token) };
  };

  socket.on('host:create', (quiz, ack) => {
    const clean = cleanQuiz(quiz);
    if (!clean) return ack({ ok: false, error: 'This quiz is not valid. Check every question has text, 2 to 4 answers and a correct one.' });
    const g = { pin: newPin(), host: socket.id, hostToken: token(), quiz: clean, players: new Map(), state: 'lobby', q: -1, startedAt: 0, timer: null, lastResults: null, touched: Date.now() };
    games.set(g.pin, g);
    socket.data.hostPin = g.pin;
    ack({ ok: true, pin: g.pin, hostToken: g.hostToken });
    socket.emit('lobby', lobbyPayload(g));
  });

  // A host whose laptop slept or refreshed picks the game back up.
  socket.on('host:rejoin', ({ pin, hostToken }, ack) => {
    const g = games.get(pin);
    if (!g || g.hostToken !== hostToken) return ack({ ok: false });
    g.host = socket.id;
    socket.data.hostPin = pin;
    ack({ ok: true, pin });
    if (g.state === 'lobby') socket.emit('lobby', lobbyPayload(g));
    else if (g.state === 'question') {
      socket.emit('question', questionPayload(g, remainingMs(g)));
      socket.emit('answered', { count: [...g.players.values()].filter((p) => p.choice !== null).length, total: g.players.size });
    } else if (g.state === 'results') socket.emit('results', g.lastResults);
    else socket.emit('end', { leaderboard: g.finalBoard.slice(0, 10) });
  });

  // Host presses Start (from the lobby) or Next (from the results).
  socket.on('host:next', () => {
    const g = hostGame();
    if (!g || (g.state !== 'lobby' && g.state !== 'results')) return;
    g.touched = Date.now();
    if (g.q + 1 >= g.quiz.questions.length) endGame(g);
    else startQuestion(g);
  });

  socket.on('host:skip', () => {
    const g = hostGame();
    if (g) endQuestion(g);
  });

  socket.on('join', ({ pin, name } = {}, ack) => {
    const g = games.get(String(pin));
    if (!g) return ack({ ok: false, error: 'No game with that PIN.' });
    const n = cleanName(name);
    if (!n || n.length > 15) return ack({ ok: false, error: 'Pick a nickname of 1 to 15 characters.' });
    if ([...g.players.values()].some((p) => p.name.toLowerCase() === n.toLowerCase())) return ack({ ok: false, error: 'That nickname is taken. Try another.' });
    if (g.players.size >= MAX_PLAYERS) return ack({ ok: false, error: 'This game is full.' });
    const p = { token: token(), sid: socket.id, name: n, score: 0, choice: null, elapsed: 0, points: 0, bonus: 0, streak: 0, correct: false, last: null };
    g.players.set(p.token, p);
    socket.data.pin = g.pin;
    socket.data.token = p.token;
    socket.join(g.pin);
    ack({ ok: true, token: p.token, name: n });
    io.to(g.host).emit('lobby', lobbyPayload(g));
  });

  // A phone that locked its screen reconnects as the same player.
  socket.on('rejoin', ({ pin, token: t } = {}, ack) => {
    const g = games.get(String(pin));
    const p = g && typeof t === 'string' && g.players.get(t);
    if (!p) return ack({ ok: false });
    p.sid = socket.id;
    socket.data.pin = g.pin;
    socket.data.token = t;
    socket.join(g.pin);
    ack({ ok: true, name: p.name });
    if (g.state === 'question') {
      if (p.choice === null) socket.emit('question', questionPayload(g, remainingMs(g)));
      else socket.emit('locked');
    } else if (g.state === 'results' && p.last) socket.emit('result', p.last);
    else if (g.state === 'end') socket.emit('end', p.last);
  });

  socket.on('answer', (choice, ack) => {
    const x = playerOf();
    if (!x || !x.p) return;
    const { g, p } = x;
    if (g.state !== 'question' || p.choice !== null) return;
    const q = g.quiz.questions[g.q];
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
    p.choice = choice;
    p.elapsed = Date.now() - g.startedAt;
    if (typeof ack === 'function') ack({ ok: true });
    const count = [...g.players.values()].filter((y) => y.choice !== null).length;
    io.to(g.host).emit('answered', { count, total: g.players.size });
    if (count === g.players.size) endQuestion(g);
  });
});

// Forget games nobody touched for 3 hours.
setInterval(() => {
  for (const [pin, g] of games) if (Date.now() - g.touched > 3 * 3600 * 1000) { clearTimeout(g.timer); games.delete(pin); }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Kannada Quiz running on http://localhost:${port}`));
}
module.exports = { server };
