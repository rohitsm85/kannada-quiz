const app = document.getElementById('app');
const socket = io();
const SHAPES = ['▲', '◆', '●', '■'];
const KEY = 'kq.quizzes';
const TIMES = [10, 20, 30, 60];

// Tiny DOM helper. Text always goes in as text, never as HTML.
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
  return e;
};
const show = (...nodes) => app.replaceChildren(...nodes.flat().filter(Boolean));

// Quizzes live in this browser. shortcut: clearing site data deletes them, so Export is the backup; add accounts only if sharing across devices is needed
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { alert('This browser could not save. Use Export to keep your quiz.'); return false; } };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const blankQ = () => ({ text: '', options: ['', '', '', ''], correct: 0, time: 20 });
const tfQ = () => ({ text: '', options: ['True', 'False'], correct: 0, time: 20 });

function problem(d) {
  if (!d.title.trim()) return 'Give the quiz a name.';
  if (!d.questions.length) return 'Add at least one question.';
  for (const [i, x] of d.questions.entries()) {
    if (!x.text.trim()) return `Question ${i + 1} needs some text.`;
    if (x.options.some((o) => !o.trim())) return `Question ${i + 1} has an empty answer.`;
  }
  return '';
}

function library() {
  const list = load();
  show(
    h('h1', {}, 'Kannada Quiz'),
    h('p', { class: 'muted' }, 'Your quizzes are saved in this browser. Use Export to keep a copy.'),
    h('div', { class: 'row' },
      h('button', { onclick: () => edit({ id: uid(), title: '', questions: [blankQ()] }) }, 'New quiz'),
      h('button', { class: 'ghost', onclick: importQuiz }, 'Import file')),
    list.length
      ? list.map((q) => h('div', { class: 'card' },
          h('b', {}, q.title), h('span', { class: 'muted' }, ` · ${q.questions.length} questions`),
          h('div', { class: 'row' },
            h('button', { onclick: () => start(q) }, 'Start game'),
            h('button', { class: 'ghost', onclick: () => edit(q) }, 'Edit'),
            h('button', { class: 'ghost', onclick: () => exportQuiz(q) }, 'Export'),
            h('button', { class: 'ghost', onclick: () => remove(q) }, 'Delete'))))
      : h('p', { class: 'muted' }, 'No quizzes yet. Create one, or import a file.'));
}

function edit(q) {
  const d = JSON.parse(JSON.stringify(q));
  const draw = () => show(
    h('h1', {}, 'Edit quiz'),
    h('label', {}, 'Quiz name', h('input', { value: d.title, maxLength: 100, oninput: (e) => { d.title = e.target.value; } })),
    d.questions.map((x, i) => questionEditor(d, x, i, draw)),
    h('div', { class: 'row' },
      h('button', { class: 'ghost', onclick: () => { d.questions.push(blankQ()); draw(); } }, '+ Question'),
      h('button', { class: 'ghost', onclick: () => { d.questions.push(tfQ()); draw(); } }, '+ True / False')),
    h('p', { class: 'error', id: 'err' }),
    h('div', { class: 'row' },
      h('button', { onclick: () => saveDraft(d) }, 'Save'),
      h('button', { class: 'ghost', onclick: library }, 'Cancel')));
  draw();
}

function questionEditor(d, x, i, draw) {
  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('b', {}, `Question ${i + 1}`),
      h('button', { class: 'ghost small', onclick: () => { d.questions.splice(i, 1); draw(); } }, 'Remove')),
    h('input', { value: x.text, placeholder: 'Question', maxLength: 300, oninput: (e) => { x.text = e.target.value; } }),
    x.options.map((o, j) => h('div', { class: 'opt' },
      h('input', { type: 'radio', name: 'c' + i, checked: x.correct === j, title: 'Correct answer', onchange: () => { x.correct = j; } }),
      h('input', { value: o, placeholder: `Answer ${j + 1}`, maxLength: 120, oninput: (e) => { x.options[j] = e.target.value; } }),
      x.options.length > 2 && h('button', { class: 'ghost small', title: 'Remove answer', onclick: () => {
        x.options.splice(j, 1);
        if (x.correct === j) x.correct = 0; else if (x.correct > j) x.correct--;
        draw();
      } }, '×'))),
    x.options.length < 4 && h('button', { class: 'ghost small', onclick: () => { x.options.push(''); draw(); } }, '+ Answer'),
    h('label', {}, 'Time ', h('select', { onchange: (e) => { x.time = +e.target.value; } },
      TIMES.map((t) => h('option', { value: t, selected: x.time === t }, `${t} seconds`)))));
}

function saveDraft(d) {
  const msg = problem(d);
  if (msg) { document.getElementById('err').textContent = msg; return; }
  const list = load();
  const i = list.findIndex((q) => q.id === d.id);
  if (i >= 0) list[i] = d; else list.push(d);
  if (save(list)) library();
}

function remove(q) {
  if (confirm(`Delete "${q.title}"? Export it first if you may need it again.`)) { save(load().filter((x) => x.id !== q.id)); library(); }
}

function exportQuiz(q) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ title: q.title, questions: q.questions }, null, 2)], { type: 'application/json' })), download: `${q.title || 'quiz'}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

function importQuiz() {
  const input = h('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
    try {
      const d = JSON.parse(await input.files[0].text());
      const ok = d && typeof d.title === 'string' && Array.isArray(d.questions) && d.questions.every((x) =>
        x && typeof x.text === 'string' && Array.isArray(x.options) && x.options.length >= 2 && x.options.length <= 4 &&
        x.options.every((o) => typeof o === 'string') && Number.isInteger(x.correct) && x.correct >= 0 && x.correct < x.options.length);
      if (!ok || problem(d)) throw new Error('bad quiz');
      d.questions.forEach((x) => { if (!TIMES.includes(x.time)) x.time = 20; });
      save([...load(), { id: uid(), title: d.title, questions: d.questions }]);
      library();
    } catch { alert('That file is not a valid quiz.'); }
  } });
  input.click();
}

// ---- Live game ----
let game = JSON.parse(sessionStorage.getItem('kq.host') || 'null');
let tick;

function start(q) {
  socket.emit('host:create', { title: q.title, questions: q.questions }, (r) => {
    if (!r.ok) return alert(r.error);
    game = { pin: r.pin, hostToken: r.hostToken };
    sessionStorage.setItem('kq.host', JSON.stringify(game));
  });
}

function leave() {
  clearInterval(tick);
  sessionStorage.removeItem('kq.host');
  game = null;
  library();
}

socket.on('lobby', (d) => {
  clearInterval(tick);
  Sound.music('lobby');
  show(
    h('p', { class: 'muted', style: 'text-align:center' }, `Join at ${location.host} with the PIN, or scan:`),
    h('img', { class: 'qr', alt: 'QR code to join', src: `/qr.svg?u=${encodeURIComponent(`${location.origin}/?pin=${game.pin}`)}` }),
    h('div', { class: 'pin' }, game.pin.replace(/(\d{3})(\d{3})/, '$1 $2')),
    h('h2', { style: 'text-align:center' }, d.title),
    h('p', { style: 'text-align:center' }, `${d.players.length} joined`),
    h('div', { class: 'chips' }, d.players.map((n) => h('span', { class: 'chip' }, n))),
    h('div', { class: 'row' },
      h('button', { disabled: !d.players.length, onclick: () => socket.emit('host:next') }, 'Start'),
      h('button', { class: 'ghost', onclick: leave }, 'Leave')));
});

socket.on('question', (q) => {
  clearInterval(tick);
  Sound.music('question');
  const t = h('span', { class: 'timer' });
  const end = Date.now() + q.remaining;
  const update = () => { t.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)); };
  update();
  tick = setInterval(update, 250);
  show(
    h('div', { class: 'row' }, h('span', { class: 'muted' }, `Question ${q.index + 1} of ${q.total}`), t),
    h('div', { class: 'q' }, q.text),
    h('div', { class: 'grid' }, q.options.map((o, i) => h('div', { class: `ans o${i}` }, SHAPES[i], ' ', o))),
    h('div', { class: 'row' },
      h('span', { id: 'ans' }, ''),
      h('button', { class: 'ghost', style: 'margin-left:auto', onclick: () => socket.emit('host:skip') }, 'Skip')));
});

socket.on('answered', ({ count, total }) => {
  const el = document.getElementById('ans');
  if (el) el.textContent = `${count} of ${total} answered`;
});

socket.on('results', (r) => {
  clearInterval(tick);
  Sound.music(null);
  show(
    h('div', { class: 'q' }, r.text),
    h('div', { class: 'grid' }, r.options.map((o, i) =>
      h('div', { class: `ans o${i} ${i === r.correct ? 'right' : 'dim'}` }, SHAPES[i], ' ', o, ` (${r.counts[i]})`))),
    h('h2', {}, 'Top players'),
    h('table', {}, r.leaderboard.map((p, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, p.name, p.streak >= 2 ? ` 🔥${p.streak}` : ''), h('td', {}, `+${p.points}`), h('td', {}, p.score)))),
    h('div', { class: 'row' }, h('button', { onclick: () => socket.emit('host:next') }, r.isLast ? 'Final scores' : 'Next')));
});

socket.on('end', ({ leaderboard }) => {
  clearInterval(tick);
  Sound.music('podium');
  const top = leaderboard.slice(0, 3);
  const spot = (i, medal) => top[i] ? h('div', { class: `p${i + 1}` }, h('div', { class: 'medal' }, medal), h('b', {}, top[i].name), h('div', {}, top[i].score)) : null;
  show(
    h('h1', { style: 'text-align:center' }, 'Final scores'),
    h('div', { class: 'podium' }, spot(1, '🥈'), spot(0, '🥇'), spot(2, '🥉')),
    h('table', {}, leaderboard.slice(3).map((p, i) => h('tr', {}, h('td', {}, i + 4), h('td', {}, p.name), h('td', {}, p.score)))),
    h('div', { class: 'row' }, h('button', { onclick: leave }, 'Back to quizzes')));
});

// Runs on first load and after every reconnect (laptop slept, Wi-Fi blip, page refresh).
socket.on('connect', () => {
  document.body.classList.remove('offline');
  if (game) socket.emit('host:rejoin', game, (r) => { if (!r.ok) leave(); });
});
socket.on('disconnect', () => document.body.classList.add('offline'));

if (game) show(h('p', { class: 'muted' }, 'Reconnecting to your game...')); else library();
