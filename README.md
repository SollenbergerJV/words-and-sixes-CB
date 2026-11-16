# Words &amp; Sixes

Two games for two players, each with a computer opponent, pass-and-play,
and online play against a real person over an invite code.

**Sixes** — lines of colour and shape, highest score wins.

**Word Squares** — crossword play on a fifteen-square board, with a
111,000-word dictionary. A word the dictionary does not know is not
refused: you may play it, and your opponent may challenge it. A right
challenge takes the play back; a wrong one costs ten points.

Voice works everywhere. Video is for computers only: a phone gets voice and
no picture, and says so rather than opening a camera nobody wants.

## Getting it online

Same route as Gin &amp; Corners.

1. Put every file in a GitHub repository. Dragging the loose files straight
   in is fine — the app detects a flattened upload and runs from it.
2. On render.com: **New → Web Service**, point it at the repository, and
   accept what it offers. `render.yaml` sets the rest.
3. Wait for **Live**, then open the address it gives you.

Nothing to install, no database, no API keys. The first visit after a quiet
spell takes 30–60 seconds while Render wakes the free instance up.

## Checking what is live

`/version` returns the version number. `/healthz` returns `ok`.

## Video across mobile networks

Two players behind strict carrier NAT — a phone on mobile data is the usual
case — may not be able to connect a call directly. If that happens, set
`TURN_URL`, `TURN_USER` and `TURN_PASS` in Render's environment settings and
the app will route through a relay. Without them it uses STUN only, which is
enough on ordinary home wi-fi.

## The tests

    npm test                the Sixes rules
    npm run test:words      the Word Squares rules
    npm run test:opponent   the Sixes computer, playing hundreds of games
    npm run test:wordbot    the Word Squares computer, playing full games
    npm run test:browser    two real browsers, a real room, a real call
    npm run test:wordui     the word board, tapped out by hand
    npm run test:flat       the same app running from a flattened upload

The browser tests need Playwright and drive actual clicks; they are the only
honest way to answer "can a person play this".

## Layout

    shared/sixes.js      the Sixes rules — the same file runs in node and the browser
    shared/sixes-ai.js   the Sixes computer opponent
    shared/words.js      the Word Squares rules
    shared/word-trie.js  the dictionary, compact enough for a phone
    shared/words-ai.js   the Word Squares computer opponent
    public/words.txt     111,000 words, served compressed
    tools/build-words.py rebuilds that list from the system dictionary
    server/index.js      static files, /version, /healthz, ICE config
    server/rooms.js      rooms, seats, and the authoritative game
    server/ws.js         a websocket implementation with no dependencies
    public/              the app itself
    start.js             finds the server whichever way the files were uploaded

The server owns the bag. Neither browser is ever sent the other player's
tiles, so cheating is removed as a category rather than discouraged as a
policy.
