'use strict';
/* Everything below is wrapped so that nothing leaks into the page's
   global names. Two rules files sharing one page is enough to make that
   matter: both of them wanted to call a function makeBag, and in a
   browser the second one to load simply replaced the first — which had
   Sixes quietly dealing from the word game's bag of a hundred tiles.
   What the rest of the app may see is listed at the bottom, and nothing
   else is reachable. */
(function () {
/* ============================================================
   WORD SQUARES — the rules.

   A fifteen by fifteen board, a hundred tiles, and the ordinary
   crossword-game rules: the first play crosses the middle, every play
   after it touches what is already there, and everything you lay down
   in one turn goes in a single line.

   Two things here are deliberate house choices rather than the usual
   ones, both decided at this table:

   A word the dictionary does not know is NOT refused. You may play it,
   and the other player may challenge it on their turn. A challenge that
   is right takes the play back; a challenge that is wrong costs the
   challenger ten points. That keeps the game out of the business of
   arguing with a spell-checker, which is all any dictionary file is.

   The premium squares are our own arrangement — the same kinds of
   square, laid out symmetrically, but not anybody else's board.
   ============================================================ */

const SIZE = 15;
const MID = 7;
const RACK = 7;
const BINGO = 50;             // for using all seven in one turn
const BAD_CHALLENGE = 10;     // what a challenge costs when the word was fine

/* '.' plain  'd' double letter  't' triple letter
   'D' double word  'T' triple word  'C' the middle square */
const PREMIUMS = [
  't.d.T.....T.d.t',
  '.D...d...d...D.',
  'd.....D.D.....d',
  '...D..d.d..D...',
  'T...t.....t...T',
  '..d..D...D..d..',
  '..t.d.....d.t..',
  '.......C.......',
  '..t.d.....d.t..',
  '..d..D...D..d..',
  'T...t.....t...T',
  '...D..d.d..D...',
  'd.....D.D.....d',
  '.D...d...d...D.',
  't.d.T.....T.d.t'
];

/* The English letter distribution: a hundred tiles, two of them blank.
   A blank is worth nothing and can stand for any letter. */
const LETTERS = {
  A: { n: 9, v: 1 }, B: { n: 2, v: 3 }, C: { n: 2, v: 3 }, D: { n: 4, v: 2 },
  E: { n: 12, v: 1 }, F: { n: 2, v: 4 }, G: { n: 3, v: 2 }, H: { n: 2, v: 4 },
  I: { n: 9, v: 1 }, J: { n: 1, v: 8 }, K: { n: 1, v: 5 }, L: { n: 4, v: 1 },
  M: { n: 2, v: 3 }, N: { n: 6, v: 1 }, O: { n: 8, v: 1 }, P: { n: 2, v: 3 },
  Q: { n: 1, v: 10 }, R: { n: 6, v: 1 }, S: { n: 4, v: 1 }, T: { n: 6, v: 1 },
  U: { n: 4, v: 1 }, V: { n: 2, v: 4 }, W: { n: 2, v: 4 }, X: { n: 1, v: 8 },
  Y: { n: 2, v: 4 }, Z: { n: 1, v: 10 }, '?': { n: 2, v: 0 }
};

function makeBag() {
  const bag = [];
  let n = 0;
  for (const ch of Object.keys(LETTERS)) {
    for (let i = 0; i < LETTERS[ch].n; i++) {
      bag.push({ id: 'w' + (n++), ch: ch, v: LETTERS[ch].v });
    }
  }
  return bag;
}

function shuffle(a, rnd) {
  const r = rnd || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function premiumAt(r, c) { return PREMIUMS[r][c]; }
function key(r, c) { return r + ',' + c; }

/* ---------- the dictionary ----------
   Membership is all the game ever asks, so a Set is the whole structure.
   It is handed in rather than loaded here: the rules have no business
   knowing whether the words came from a file, a server or a test. */
function Dictionary(words) {
  this.words = new Set();
  if (words) this.add(words);
}
Dictionary.prototype.add = function (words) {
  const list = typeof words === 'string' ? words.split(/\s+/) : words;
  for (const w of list) {
    const t = String(w).trim().toLowerCase();
    if (t) this.words.add(t);
  }
};
Dictionary.prototype.has = function (w) {
  return this.words.has(String(w).toLowerCase());
};
Dictionary.prototype.size = function () { return this.words.size; };

/* ---------- the game ---------- */
function WordGame(opts) {
  opts = opts || {};
  this.rnd = opts.rnd || Math.random;
  this.dict = opts.dict || new Dictionary();
  this.names = opts.names ? opts.names.slice() : ['Player 1', 'Player 2'];
  this.scores = [0, 0];
  this.startGame(opts.first || 0);
}

WordGame.prototype.startGame = function (first) {
  this.bag = shuffle(makeBag(), this.rnd);
  this.board = {};                 // "r,c" -> { ch, v, blank }
  this.placed = [];                // this turn, not yet submitted
  this.racks = [[], []];
  for (let i = 0; i < RACK; i++) {
    this.racks[0].push(this.bag.pop());
    this.racks[1].push(this.bag.pop());
  }
  this.turn = first || 0;
  this.scores = [0, 0];
  this.phase = 'play';             // 'play' | 'ended'
  this.passes = 0;                 // two passes each in a row ends it
  this.lastPlay = null;            // what the other player just did
  this.open = null;                // a play that may still be challenged
  this.ended = null;
  this.history = [];
};

WordGame.prototype.at = function (r, c) { return this.board[key(r, c)] || null; };
WordGame.prototype.workingAt = function (r, c) {
  for (const p of this.placed) if (p.r === r && p.c === c) return p.tile;
  return this.at(r, c);
};
WordGame.prototype.isEmpty = function () { return Object.keys(this.board).length === 0; };
WordGame.prototype.rackOf = function (p) { return this.racks[p]; };

/* ---------- laying a tile out ---------- */
WordGame.prototype.canPlace = function (p, tileId, r, c, asLetter) {
  if (this.phase !== 'play') return { ok: false, why: 'The game is over.' };
  if (this.turn !== p) return { ok: false, why: 'It is not your turn.' };
  if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return { ok: false, why: 'That is off the board.' };
  const tile = this.racks[p].find(t => t.id === tileId);
  if (!tile) return { ok: false, why: 'That tile is not on your rack.' };
  if (this.workingAt(r, c)) return { ok: false, why: 'There is already a letter there.' };
  if (tile.ch === '?' && !/^[A-Za-z]$/.test(String(asLetter || ''))) {
    return { ok: false, why: 'Choose a letter for the blank.' };
  }
  /* Everything this turn goes in one line, which is cheapest to check as
     the tiles go down rather than all at once at the end. */
  if (this.placed.length) {
    const sameRow = this.placed.every(x => x.r === r);
    const sameCol = this.placed.every(x => x.c === c);
    if (!sameRow && !sameCol) {
      return { ok: false, why: 'Everything you play in one turn goes in a single line.' };
    }
  }
  return { ok: true };
};

WordGame.prototype.place = function (p, tileId, r, c, asLetter) {
  const v = this.canPlace(p, tileId, r, c, asLetter);
  if (!v.ok) throw new Error(v.why);
  const i = this.racks[p].findIndex(t => t.id === tileId);
  const tile = this.racks[p].splice(i, 1)[0];
  const face = tile.ch === '?' ? String(asLetter).toUpperCase() : tile.ch;
  this.placed.push({
    r: r, c: c, from: i,
    tile: { id: tile.id, ch: face, v: tile.ch === '?' ? 0 : tile.v, blank: tile.ch === '?' }
  });
  return this.placed.length;
};

WordGame.prototype.unplace = function (p, tileId) {
  if (this.turn !== p) throw new Error('It is not your turn.');
  const i = this.placed.findIndex(x => x.tile.id === tileId);
  if (i < 0) throw new Error('That tile is not on the board.');
  const back = this.placed.splice(i, 1)[0];
  const original = back.tile.blank
    ? { id: back.tile.id, ch: '?', v: 0 }
    : { id: back.tile.id, ch: back.tile.ch, v: back.tile.v };
  const at = Math.max(0, Math.min(back.from, this.racks[p].length));
  this.racks[p].splice(at, 0, original);
};

WordGame.prototype.takeBackAll = function (p) {
  while (this.placed.length) this.unplace(p, this.placed[this.placed.length - 1].tile.id);
};

/* ---------- reading the words off the board ---------- */
WordGame.prototype.wordThrough = function (r, c, dr, dc) {
  let rr = r - dr, cc = c - dc;
  while (rr >= 0 && cc >= 0 && this.workingAt(rr, cc)) { rr -= dr; cc -= dc; }
  rr += dr; cc += dc;
  const out = [];
  while (rr < SIZE && cc < SIZE && rr >= 0 && cc >= 0 && this.workingAt(rr, cc)) {
    out.push({ r: rr, c: cc, tile: this.workingAt(rr, cc) });
    rr += dr; cc += dc;
  }
  return out;
};

/* Every word this turn makes or lengthens, each one once. */
WordGame.prototype.wordsFormed = function () {
  const seen = new Set();
  const out = [];
  for (const p of this.placed) {
    for (const dir of [[0, 1], [1, 0]]) {
      const run = this.wordThrough(p.r, p.c, dir[0], dir[1]);
      if (run.length < 2) continue;
      const id = dir.join(':') + '@' + run[0].r + ',' + run[0].c + ':' + run.length;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(run);
    }
  }
  return out;
};

function runText(run) { return run.map(x => x.tile.ch).join(''); }

/* ---------- is this a legal play at all ---------- */
WordGame.prototype.checkPlacement = function () {
  if (!this.placed.length) return { ok: false, why: 'Lay down at least one tile, or pass.' };

  const rows = this.placed.map(x => x.r), cols = this.placed.map(x => x.c);
  const oneRow = rows.every(x => x === rows[0]);
  const oneCol = cols.every(x => x === cols[0]);
  if (!oneRow && !oneCol) return { ok: false, why: 'Everything you play goes in a single line.' };

  /* No holes: the stretch the new tiles span has to be solid, counting the
     letters that were already there. */
  const dr = oneRow ? 0 : 1, dc = oneRow ? 1 : 0;
  const from = oneRow ? Math.min.apply(null, cols) : Math.min.apply(null, rows);
  const to = oneRow ? Math.max.apply(null, cols) : Math.max.apply(null, rows);
  const fixed = oneRow ? rows[0] : cols[0];
  for (let i = from; i <= to; i++) {
    const r = oneRow ? fixed : i, c = oneRow ? i : fixed;
    if (!this.workingAt(r, c)) return { ok: false, why: 'Leave no gaps — fill the squares in between.' };
  }

  if (this.isEmpty()) {
    const onStar = this.placed.some(x => x.r === MID && x.c === MID);
    if (!onStar) return { ok: false, why: 'The first word has to cross the middle square.' };
    if (this.placed.length < 2) return { ok: false, why: 'The first word needs at least two letters.' };
  } else {
    /* It has to touch what is already down, somewhere. */
    const touches = this.placed.some(function (x) {
      return [[0, 1], [0, -1], [1, 0], [-1, 0]].some(d => {
        const rr = x.r + d[0], cc = x.c + d[1];
        return rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE && !!this.at(rr, cc);
      });
    }, this);
    if (!touches) return { ok: false, why: 'Your word has to join on to the letters already down.' };
  }

  const words = this.wordsFormed();
  if (!words.length) return { ok: false, why: 'That does not make a word.' };
  return { ok: true, words: words };
};

/* ---------- what it scores ----------
   A premium square counts only on the turn the tile lands on it, and a
   word multiplier applies to the whole word after the letter multipliers
   have done their work. */
WordGame.prototype.scoreFor = function (words) {
  let total = 0;
  const fresh = new Set(this.placed.map(p => key(p.r, p.c)));

  for (const run of words) {
    let sum = 0, wordMult = 1;
    for (const cell of run) {
      let v = cell.tile.v;
      if (fresh.has(key(cell.r, cell.c))) {
        const prem = premiumAt(cell.r, cell.c);
        if (prem === 'd') v *= 2;
        else if (prem === 't') v *= 3;
        else if (prem === 'D' || prem === 'C') wordMult *= 2;
        else if (prem === 'T') wordMult *= 3;
      }
      sum += v;
    }
    total += sum * wordMult;
  }
  if (this.placed.length === RACK) total += BINGO;
  return total;
};

/* What the current layout would be worth, for the running total on screen. */
WordGame.prototype.turnScore = function () {
  const v = this.checkPlacement();
  if (!v.ok) return 0;
  return this.scoreFor(v.words);
};

/* ---------- playing the turn ----------
   The words are not checked here. An unknown word is allowed to stand;
   the other player decides whether to challenge it. */
WordGame.prototype.submit = function (p) {
  if (this.phase !== 'play') throw new Error('The game is over.');
  if (this.turn !== p) throw new Error('It is not your turn.');
  const v = this.checkPlacement();
  if (!v.ok) throw new Error(v.why);

  const gained = this.scoreFor(v.words);
  const played = this.placed.slice();
  const texts = v.words.map(runText);

  for (const x of played) this.board[key(x.r, x.c)] = x.tile;
  this.placed = [];
  this.scores[p] += gained;
  this.passes = 0;

  /* Kept whole so a successful challenge can put it back exactly. */
  this.open = { by: p, tiles: played, score: gained, words: texts };
  this.lastPlay = { who: p, kind: 'played', score: gained, words: texts };
  this.history.push({ who: p, words: texts, score: gained });

  const wentOut = this.racks[p].length === 0 && this.bag.length === 0;
  while (this.racks[p].length < RACK && this.bag.length) this.racks[p].push(this.bag.pop());

  if (wentOut) return this.finish(p);
  this.turn = 1 - p;
  return gained;
};

/* ---------- challenging ----------
   Only the player who did not make the play, and only before they have
   done anything else with their turn. */
WordGame.prototype.canChallenge = function (p) {
  return this.phase === 'play' && !!this.open && this.open.by !== p &&
    this.turn === p && this.placed.length === 0;
};

WordGame.prototype.challenge = function (p) {
  if (!this.canChallenge(p)) throw new Error('There is nothing to challenge.');
  const play = this.open;
  const bad = play.words.filter(w => !this.dict.has(w));

  if (bad.length) {
    /* The challenge was right: the tiles come back and the play scores
       nothing. The challenger carries on with their own turn. */
    for (const x of play.tiles) delete this.board[key(x.r, x.c)];
    this.scores[play.by] -= play.score;
    const back = this.racks[play.by];
    /* The replacements drawn after the play go back to the bag FIRST, all
       of them, and only then do the played tiles return. Doing it one for
       one in a single loop pops the tile just pushed, and the player ends
       up a tile short — which is how a challenge could quietly eat a Z. */
    const room = RACK - play.tiles.length;
    while (back.length > room) this.bag.push(back.pop());
    for (const x of play.tiles) {
      back.push(x.tile.blank
        ? { id: x.tile.id, ch: '?', v: 0 }
        : { id: x.tile.id, ch: x.tile.ch, v: x.tile.v });
    }
    shuffle(this.bag, this.rnd);
    this.open = null;
    this.lastPlay = { who: p, kind: 'challenge-won', words: bad, against: play.by };
    return { upheld: true, words: bad };
  }

  /* The challenge was wrong, and that costs. */
  this.scores[p] -= BAD_CHALLENGE;
  this.open = null;
  this.lastPlay = { who: p, kind: 'challenge-lost', cost: BAD_CHALLENGE };
  return { upheld: false, cost: BAD_CHALLENGE };
};

/* ---------- swapping and passing ---------- */
WordGame.prototype.swap = function (p, ids) {
  if (this.phase !== 'play') throw new Error('The game is over.');
  if (this.turn !== p) throw new Error('It is not your turn.');
  if (this.placed.length) throw new Error('Take your tiles back before swapping.');
  if (!ids || !ids.length) throw new Error('Choose at least one tile to swap.');
  if (ids.length > this.bag.length) throw new Error('There are only ' + this.bag.length + ' tiles left in the bag.');

  const out = [];
  for (const id of ids) {
    const i = this.racks[p].findIndex(t => t.id === id);
    if (i < 0) throw new Error('That tile is not on your rack.');
    out.push(this.racks[p].splice(i, 1)[0]);
  }
  while (this.racks[p].length < RACK && this.bag.length) this.racks[p].push(this.bag.pop());
  for (const t of out) this.bag.push(t);
  shuffle(this.bag, this.rnd);

  this.open = null;
  this.passes = 0;
  this.lastPlay = { who: p, kind: 'swapped', count: out.length };
  this.turn = 1 - p;
  return 0;
};

WordGame.prototype.pass = function (p) {
  if (this.phase !== 'play') throw new Error('The game is over.');
  if (this.turn !== p) throw new Error('It is not your turn.');
  if (this.placed.length) throw new Error('Take your tiles back first.');
  this.open = null;
  this.passes++;
  this.lastPlay = { who: p, kind: 'passed' };
  /* Four passes in a row — two each — means neither player is getting
     anywhere, and the game is over where it stands. */
  if (this.passes >= 4) return this.finish(null);
  this.turn = 1 - p;
  return 0;
};

/* ---------- the end ----------
   Whoever goes out takes what is left on the other rack; if nobody goes
   out, each player simply drops what they are holding. */
WordGame.prototype.finish = function (wentOut) {
  this.phase = 'ended';
  const left = [0, 1].map(p => this.racks[p].reduce((n, t) => n + t.v, 0));

  if (wentOut !== null && wentOut !== undefined) {
    this.scores[wentOut] += left[1 - wentOut];
    this.scores[1 - wentOut] -= left[1 - wentOut];
  } else {
    this.scores[0] -= left[0];
    this.scores[1] -= left[1];
  }

  const s = this.scores;
  const winner = s[0] === s[1] ? null : (s[0] > s[1] ? 0 : 1);
  this.ended = {
    winner: winner, scores: s.slice(), out: wentOut === undefined ? null : wentOut,
    left: left, level: winner === null
  };
  return 0;
};

/* ---------- node and the browser ---------- */
if (typeof window !== 'undefined') {
  window.WordGame = WordGame;
  window.WordDictionary = Dictionary;
  window.WORD_SIZE = SIZE;
  window.WORD_PREMIUMS = PREMIUMS;
  window.WORD_LETTERS = LETTERS;
  window.WORD_RACK = RACK;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WordGame: WordGame, Dictionary: Dictionary, makeBag: makeBag, shuffle: shuffle,
    SIZE: SIZE, MID: MID, RACK: RACK, BINGO: BINGO, BAD_CHALLENGE: BAD_CHALLENGE,
    PREMIUMS: PREMIUMS, LETTERS: LETTERS, premiumAt: premiumAt
  };
}
})();
