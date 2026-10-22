// Music and sound effects made with the Web Audio API: no audio files, nothing to download.
const Sound = (() => {
  let ctx, loop, muted = localStorage.getItem('kq.mute') === '1';
  const SONGS = {
    // [bpm, notes as semitones above C4, null = rest]. Pentatonic, so it never sounds wrong.
    lobby: { bpm: 92, wave: 'sine', seq: [0, 4, 7, 9, 7, 4, 9, 7, 0, 4, 7, 12, 9, 7, 4, null] },
    podium: { bpm: 124, wave: 'triangle', seq: [0, 4, 7, 12, 7, 12, 16, 12, 9, 12, 14, 12, 16, 19, 16, null] },
  };
  const freq = (s) => 261.63 * 2 ** (s / 12);
  const tone = (f, t, len, wave, vol) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + len);
  };
  const ready = () => {
    if (muted) return false;
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  };
  const stop = () => { clearInterval(loop); loop = null; };
  let current = null;
  function music(name) {
    current = name;
    stop();
    if (!name || !SONGS[name] || !ready()) return;
    const s = SONGS[name], step = 60 / s.bpm / 2;
    let i = 0, next = ctx.currentTime + 0.05;
    // Schedule a little ahead of the clock so timing stays steady even when the tab is busy.
    loop = setInterval(() => {
      while (next < ctx.currentTime + 0.3) {
        const n = s.seq[i++ % s.seq.length];
        if (n !== null) tone(freq(n), next, step * 0.9, s.wave, 0.025);
        if (i % 8 === 1) tone(freq(-12), next, step * 3, 'sine', 0.04); // bass on every 8th step
        next += step;
      }
    }, 100);
  }
  const FX = {
    right: [[0, 0], [4, 0.1], [7, 0.2], [12, 0.3]],
    wrong: [[-2, 0], [-6, 0.15]],
    join: [[7, 0], [12, 0.1]],
    streak: [[0, 0], [7, 0.08], [12, 0.16], [16, 0.24], [19, 0.32]],
  };
  function fx(name) {
    if (!ready()) return;
    const t = ctx.currentTime;
    for (const [n, d] of FX[name]) tone(freq(n + 12), t + d, 0.25, name === 'wrong' ? 'sawtooth' : 'triangle', 0.12);
  }
  const toggle = () => { muted = !muted; localStorage.setItem('kq.mute', muted ? '1' : '0'); if (muted) stop(); else music(current); return muted; };
  // Browsers only allow sound after a tap or click. Wake the audio on the first one.
  addEventListener('pointerdown', () => { if (current && !loop) music(current); else ready(); });
  return { music, fx, toggle, isMuted: () => muted };
})();

// A small mute button in the corner of every page.
document.addEventListener('DOMContentLoaded', () => {
  const b = document.createElement('button');
  b.className = 'mute';
  b.setAttribute('aria-label', 'Sound on or off');
  const paint = () => { b.textContent = Sound.isMuted() ? '🔇' : '🔊'; };
  b.onclick = () => { Sound.toggle(); paint(); };
  paint();
  document.body.append(b);
});
