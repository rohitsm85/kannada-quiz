# Kannada Quiz

A live classroom quiz. The teacher hosts on a laptop or projector, students join from any phone, tablet or laptop with a PIN.

## Run it

```
npm install
npm start
```

- Teacher: open `http://localhost:3000/host`
- Students: open the address of the teacher's computer, for example `http://192.168.1.20:3000`, on the same Wi-Fi, and enter the PIN.

## Put it online (Render, free)

1. Put this folder in a GitHub repository (needs your own GitHub account).
2. On render.com choose New > Blueprint, pick the repository. `render.yaml` sets everything up.
3. You get an address like `https://kannada-quiz.onrender.com`. Teacher opens `/host`, students open the plain address or scan the QR code on the lobby screen.

The free plan goes to sleep when idle, so open the host page a few minutes before class and let it wake up. It needs a host that keeps connections open, so Vercel will not work.

## Scoring and sound

- Right answer: 1000 points down to 500 by speed. Wrong or no answer: 0.
- Streak: each extra right answer in a row adds 100, up to +500. A wrong answer resets it.
- Music and sound effects are made in the browser (no audio files). The speaker button in the corner mutes them. Browsers only allow sound after a tap, so the teacher clicks once on the page.
- The teacher's screen plays the music; phones play short sound effects.

## Notes

- Quizzes are saved in the teacher's browser. Use Export to keep a copy as a file and Import to load it again.
- Games live in memory. If the server restarts, a running game ends.
- `npm test` plays a whole game with fake players.
