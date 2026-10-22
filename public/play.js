const app = document.getElementById('app');
const socket = io();
const SHAPES = ['▲', '◆', '●', '■'];

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
const screen = (cls, ...kids) => show(h('div', { class: `screen ${cls}` }, ...kids));

let me = JSON.parse(sessionStorage.getItem('kq.player') || 'null');

function joinView(msg = '') {
  const pin = h('input', { inputMode: 'numeric', maxLength: 6, placeholder: 'Game PIN', value: new URLSearchParams(location.search).get('pin') || '' });
  const name = h('input', { maxLength: 15, placeholder: 'Nickname' });
  const err = h('p', { class: 'error' }, msg);
  const go = () => {
    const p = pin.value.trim(), n = name.value.trim();
    if (!/^\d{6}$/.test(p)) { err.textContent = 'Enter the 6-digit PIN.'; return; }
    if (!n) { err.textContent = 'Enter a nickname.'; return; }
    socket.emit('join', { pin: p, name: n }, (r) => {
      if (!r.ok) { err.textContent = r.error; return; }
      me = { pin: p, token: r.token, name: r.name };
      sessionStorage.setItem('kq.player', JSON.stringify(me));
      Sound.fx('join');
      waitView();
    });
  };
  show(h('form', { class: 'screen', onsubmit: (e) => { e.preventDefault(); go(); } },
    h('h1', {}, 'Kannada Quiz'), pin, name, err,
    h('button', { type: 'submit' }, 'Join'),
    h('p', { class: 'muted' }, 'Please do not use your real name.')));
}

const waitView = () => screen('', h('div', { class: 'big' }, `You're in, ${me.name}!`), h('p', { class: 'muted' }, 'Watch the big screen. The quiz starts soon.'));
const lockedView = () => screen('', h('div', { class: 'big' }, 'Answer sent!'), h('p', { class: 'muted' }, 'Waiting for everyone...'));

socket.on('question', (q) => {
  const bar = h('div', { class: 'bar' });
  show(
    h('p', { class: 'muted' }, `Question ${q.index + 1} of ${q.total}`),
    bar,
    h('div', { class: 'q' }, q.text),
    h('div', { class: 'grid' }, q.options.map((o, i) =>
      h('button', { class: `o${i}`, onclick: () => { socket.emit('answer', i); lockedView(); } }, SHAPES[i], ' ', o))));
  // Shrink the bar over the time left, started on the next frame so the transition runs.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `transform ${q.remaining}ms linear`;
    bar.style.transform = 'scaleX(0)';
  }));
});

socket.on('locked', lockedView);

socket.on('result', (r) => {
  screen(r.correct ? 'good' : 'bad',
    h('div', { class: 'big' }, r.answered ? (r.correct ? 'Correct!' : 'Not quite') : "Time's up"),
    h('p', {}, r.correct ? `+${r.points} points` : `Answer: ${r.correctText}`),
    r.streak >= 2 ? h('p', { class: 'streak' }, `🔥 ${r.streak} in a row! Bonus +${r.bonus}`) : null,
    h('p', {}, `${r.score} points · #${r.rank} of ${r.total}`));
  Sound.fx(r.streak >= 3 ? 'streak' : r.correct ? 'right' : 'wrong');
});

socket.on('end', (r) => {
  sessionStorage.removeItem('kq.player');
  Sound.fx(r.rank <= 3 ? 'streak' : 'join');
  screen('', h('div', { class: 'big' }, r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : null), h('div', { class: 'big' }, 'Game over!'), h('p', {}, `You finished #${r.rank} of ${r.total}`), h('p', {}, `${r.score} points`),
    h('button', { onclick: () => { me = null; joinView(); } }, 'Play again'));
});

// Runs on first load and after every reconnect (phone screen locked, Wi-Fi blip, page refresh).
socket.on('connect', () => {
  document.body.classList.remove('offline');
  if (me) socket.emit('rejoin', me, (r) => {
    if (r.ok) waitView(); // any state message the server sends next replaces this
    else { me = null; sessionStorage.removeItem('kq.player'); joinView('That game has ended. Join a new one.'); }
  });
});
socket.on('disconnect', () => document.body.classList.add('offline'));

if (me) show(h('p', { class: 'muted' }, 'Reconnecting...')); else joinView();
