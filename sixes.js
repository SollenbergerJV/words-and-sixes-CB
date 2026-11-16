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
   SIXES — the rules.

   A tile has a colour and a shape, and there are three of every
   combination: six colours by six shapes by three copies, 108 tiles in
   the bag. On your turn you add tiles to the table in one straight
   line, and every line you touch has to make sense: either all one
   colour with no shape repeated, or all one shape with no colour
   repeated. Lines stop at six because that is every colour, or every
   shape, and there is nothing left to add.

   You score a point for each tile in every line you built or added to,
   and six more for completing a line of six. Empty the bag, then empty
   your hand, and you get six more for going out.

   No drawing happens here except through the bag, and the bag is part
   of the game state, so a game can be handed to the server, redacted,
   and handed back without anything leaking.
   ============================================================ */

const COLORS = ['R', 'O', 'Y', 'G', 'B', 'P'];
const SHAPES = ['circle', 'square', 'diamond', 'cross', 'star', 'burst'];
const LINE_MAX = 6;
const HAND_SIZE = 6;
const SIX_BONUS = 6;
const OUT_BONUS = 6;

const COLOR_NAME = { R: 'red', O: 'orange', Y: 'yellow', G: 'green', B: 'blue', P: 'purple' };

function makeBag() {
  const bag = [];
  let n = 0;
  for (let copy = 0; copy < 3; copy++) {
    for (const c of COLORS) {
      for (const s of SHAPES) {
        bag.push({ id: 't' + (n++), c: c, s: s });
      }
    }
  }
  return bag;
}

/* Fisher-Yates with an injectable source of randomness, so a test can
   deal a known bag and a game can still be properly shuffled. */
function shuffle(a, rnd) {
  const r = rnd || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function key(r, c) { return r + ',' + c; }
function tileName(t) {
  return t ? COLOR_NAME[t.c] + ' ' + t.s : '';
}

/* ---------- the game ---------- */
function SixesGame(opts) {
  opts = opts || {};
  this.target = opts.target || 0;        // 0 = a single game rather than a match
  this.rnd = opts.rnd || Math.random;
  this.scores = [0, 0];
  this.wins = [0, 0];
  this.matchOver = false;
  this.startGame(opts.first || 0);
}

SixesGame.prototype.startGame = function (first) {
  this.bag = shuffle(makeBag(), this.rnd);
  this.board = {};                        // "r,c" -> tile
  this.placed = [];                       // tiles laid down this turn, not yet committed
  this.hands = [[], []];
  for (let i = 0; i < HAND_SIZE; i++) {
    this.hands[0].push(this.bag.pop());
    this.hands[1].push(this.bag.pop());
  }
  this.turn = first || 0;
  this.gameScores = [0, 0];
  this.phase = 'play';                    // 'play' | 'ended'
  this.lastTurn = null;                   // what the other player just did
  this.ended = null;
  this.bounds = { r0: 0, r1: 0, c0: 0, c1: 0, empty: true };
};

SixesGame.prototype.at = function (r, c) { return this.board[key(r, c)] || null; };

/* The board during a turn is the committed board plus whatever is sitting
   out unconfirmed, so every rule below sees the position as it looks. */
SixesGame.prototype.workingAt = function (r, c) {
  for (const p of this.placed) if (p.r === r && p.c === c) return p.tile;
  return this.at(r, c);
};

SixesGame.prototype.isEmpty = function () {
  return Object.keys(this.board).length === 0 && this.placed.length === 0;
};

/* ---------- what makes a line legal ----------
   A run is the unbroken stretch of tiles either side of a square. It is
   legal when the tiles are all one colour with every shape different, or
   all one shape with every colour different. Six is the natural ceiling
   and a seventh tile could only be a repeat, but the length is checked
   anyway: a rule that is only implied is a rule waiting to be broken. */
function runOk(tiles) {
  if (tiles.length <= 1) return { ok: true };
  if (tiles.length > LINE_MAX) return { ok: false, why: 'A line cannot be longer than six tiles.' };
  const sameColor = tiles.every(t => t.c === tiles[0].c);
  const sameShape = tiles.every(t => t.s === tiles[0].s);
  if (!sameColor && !sameShape) {
    return { ok: false, why: 'A line has to be all one colour or all one shape.' };
  }
  const seen = new Set();
  for (const t of tiles) {
    const k = sameColor ? t.s : t.c;
    if (seen.has(k)) {
      return { ok: false, why: sameColor
        ? 'That line would have two ' + t.s + 's in it.'
        : 'That line would have two ' + COLOR_NAME[t.c] + ' tiles in it.' };
    }
    seen.add(k);
  }
  return { ok: true };
};

/* The run through a square, in one direction. dr/dc is the step. */
SixesGame.prototype.runThrough = function (r, c, dr, dc) {
  const out = [];
  let rr = r - dr, cc = c - dc;
  while (this.workingAt(rr, cc)) { out.unshift({ r: rr, c: cc, t: this.workingAt(rr, cc) }); rr -= dr; cc -= dc; }
  const here = this.workingAt(r, c);
  if (here) out.push({ r: r, c: c, t: here });
  rr = r + dr; cc = c + dc;
  while (this.workingAt(rr, cc)) { out.push({ r: rr, c: cc, t: this.workingAt(rr, cc) }); rr += dr; cc += dc; }
  return out;
};

/* ---------- laying a tile down ----------
   Returns {ok:true} or {ok:false, why:"plain english"}. Nothing is changed
   unless it is legal, so the caller can offer the reason to the player
   rather than silently refusing. */
SixesGame.prototype.canPlace = function (p, tileId, r, c) {
  if (this.phase !== 'play') return { ok: false, why: 'The game is over.' };
  if (this.turn !== p) return { ok: false, why: 'It is not your turn.' };
  const tile = this.hands[p].find(t => t.id === tileId);
  if (!tile) return { ok: false, why: 'That tile is not in your hand.' };
  if (this.workingAt(r, c)) return { ok: false, why: 'There is already a tile there.' };

  /* everything this turn goes in one straight line */
  if (this.placed.length) {
    const sameRow = this.placed.every(x => x.r === r);
    const sameCol = this.placed.every(x => x.c === c);
    if (!sameRow && !sameCol) {
      return { ok: false, why: 'Everything you play in one turn goes in a single line.' };
    }
  }

  /* try it and see whether the position still makes sense */
  this.placed.push({ tile: tile, r: r, c: c });
  const verdict = this.positionOk(r, c);
  this.placed.pop();
  return verdict;
};

SixesGame.prototype.positionOk = function (r, c) {
  const across = this.runThrough(r, c, 0, 1);
  const down = this.runThrough(r, c, 1, 0);

  const a = runOk(across.map(x => x.t));
  if (!a.ok) return { ok: false, why: a.why };
  const d = runOk(down.map(x => x.t));
  if (!d.ok) return { ok: false, why: d.why };

  /* A tile has to touch what is already there — on an empty board the
     first tile of the first turn is the exception, and after that the
     turn's own tiles count as "already there". */
  const alone = across.length === 1 && down.length === 1;
  if (alone && (Object.keys(this.board).length > 0 || this.placed.length > 1)) {
    return { ok: false, why: 'Tiles have to join on to the ones already down.' };
  }

  /* Tiles laid this turn must end up in one unbroken line, not scattered
     along it with a hole in the middle. */
  if (this.placed.length > 1) {
    const rows = this.placed.map(x => x.r), cols = this.placed.map(x => x.c);
    const oneRow = rows.every(x => x === rows[0]);
    const line = oneRow ? across : down;
    const inLine = this.placed.every(p2 => line.some(x => x.r === p2.r && x.c === p2.c));
    if (!inLine) return { ok: false, why: 'Leave no gaps — the tiles you play must sit in one unbroken line.' };
  }
  return { ok: true };
};

SixesGame.prototype.place = function (p, tileId, r, c) {
  const v = this.canPlace(p, tileId, r, c);
  if (!v.ok) throw new Error(v.why);
  const i = this.hands[p].findIndex(t => t.id === tileId);
  const tile = this.hands[p].splice(i, 1)[0];
  /* Where it came from, so taking it back puts it where it was. A tile that
     reappears at the far end of the hand every time you change your mind is
     a small thing that makes a hand impossible to keep track of. */
  this.placed.push({ tile: tile, r: r, c: c, from: i });
  return this.turnScore();
};

/* Take back a tile that has not been committed. */
SixesGame.prototype.unplace = function (p, tileId) {
  if (this.turn !== p) throw new Error('It is not your turn.');
  const i = this.placed.findIndex(x => x.tile.id === tileId);
  if (i < 0) throw new Error('That tile is not on the table.');
  const back = this.placed.splice(i, 1)[0];
  const at = Math.max(0, Math.min(back.from === undefined ? this.hands[p].length : back.from,
    this.hands[p].length));
  this.hands[p].splice(at, 0, back.tile);
  return this.turnScore();
};

SixesGame.prototype.takeBackAll = function (p) {
  while (this.placed.length) this.unplace(p, this.placed[this.placed.length - 1].tile.id);
};

/* ---------- scoring ----------
   Every line that contains a tile played this turn scores its own length,
   and six more if it is complete. A tile that lands in both a row and a
   column scores in both — that is where the big turns come from. A lone
   first tile scores one. */
SixesGame.prototype.turnScore = function () {
  if (!this.placed.length) return 0;
  const counted = new Set();
  let total = 0;

  for (const p of this.placed) {
    for (const dir of [[0, 1], [1, 0]]) {
      const run = this.runThrough(p.r, p.c, dir[0], dir[1]);
      if (run.length < 2) continue;
      const id = dir.join(':') + '@' + run[0].r + ',' + run[0].c;
      if (counted.has(id)) continue;
      counted.add(id);
      total += run.length + (run.length === LINE_MAX ? SIX_BONUS : 0);
    }
  }
  if (total === 0) total = 1;          // the very first tile, alone on the table
  return total;
};

SixesGame.prototype.commit = function (p) {
  if (this.phase !== 'play') throw new Error('The game is over.');
  if (this.turn !== p) throw new Error('It is not your turn.');
  if (!this.placed.length) throw new Error('Play at least one tile, or swap instead.');

  const gained = this.turnScore();
  const played = this.placed.slice();
  for (const x of this.placed) this.board[key(x.r, x.c)] = x.tile;
  this.placed = [];
  this.gameScores[p] += gained;
  this.growBounds(played);

  /* Refill, then check for the end: the bag has to be empty AND the hand
     has to be empty, which can only happen on the same turn. */
  const wentOut = this.hands[p].length === 0 && this.bag.length === 0;
  while (this.hands[p].length < HAND_SIZE && this.bag.length) this.hands[p].push(this.bag.pop());
  if (wentOut) this.gameScores[p] += OUT_BONUS;

  this.lastTurn = {
    who: p, kind: 'played', score: gained, out: wentOut,
    tiles: played.map(x => ({ r: x.r, c: x.c, c2: x.tile.c, s: x.tile.s }))
  };

  if (wentOut) return this.finish(p);
  if (this.stuck()) return this.finish(null);
  this.turn = 1 - p;
  return gained;
};

/* Nobody can move and the bag is empty: the game is over where it stands
   rather than passing back and forth for ever. */
SixesGame.prototype.stuck = function () {
  if (this.bag.length) return false;
  return !this.hasAnyPlay(0) && !this.hasAnyPlay(1);
};

SixesGame.prototype.swap = function (p, ids) {
  if (this.phase !== 'play') throw new Error('The game is over.');
  if (this.turn !== p) throw new Error('It is not your turn.');
  if (this.placed.length) throw new Error('Take your tiles back before swapping.');
  if (!ids || !ids.length) throw new Error('Choose at least one tile to swap.');
  if (ids.length > this.bag.length) throw new Error('There are only ' + this.bag.length + ' tiles left in the bag.');

  const out = [];
  for (const id of ids) {
    const i = this.hands[p].findIndex(t => t.id === id);
    if (i < 0) throw new Error('That tile is not in your hand.');
    out.push(this.hands[p].splice(i, 1)[0]);
  }
  while (this.hands[p].length < HAND_SIZE && this.bag.length) this.hands[p].push(this.bag.pop());
  for (const t of out) this.bag.push(t);
  shuffle(this.bag, this.rnd);

  this.lastTurn = { who: p, kind: 'swapped', count: out.length };
  if (this.stuck()) return this.finish(null);
  this.turn = 1 - p;
  return 0;
};

/* ---------- when there is nothing you can do ----------
   With the bag empty and no legal square for any tile in your hand, there
   is no move and no swap either. Without this the turn could never end:
   the game simply stopped, with the player staring at a board and no
   button to press. Passing is allowed only when it is genuinely forced,
   so it cannot be used to stall. */
SixesGame.prototype.mustPass = function (p) {
  return this.phase === 'play' && this.placed.length === 0 &&
    this.bag.length === 0 && !this.hasAnyPlay(p);
};

SixesGame.prototype.pass = function (p) {
  if (this.phase !== 'play') throw new Error('The game is over.');
  if (this.turn !== p) throw new Error('It is not your turn.');
  if (this.placed.length) throw new Error('Take your tiles back first.');
  if (this.bag.length) throw new Error('There are still tiles in the bag — swap instead of passing.');
  if (this.hasAnyPlay(p)) throw new Error('You still have a move.');

  this.lastTurn = { who: p, kind: 'passed' };
  if (this.stuck()) return this.finish(null);
  this.turn = 1 - p;
  return 0;
};

SixesGame.prototype.finish = function (wentOut) {
  this.phase = 'ended';
  const s = this.gameScores;
  const winner = s[0] === s[1] ? null : (s[0] > s[1] ? 0 : 1);
  this.ended = { winner: winner, scores: s.slice(), out: wentOut, level: winner === null };
  this.scores[0] += s[0];
  this.scores[1] += s[1];
  if (winner !== null) this.wins[winner]++;
  if (this.target) {
    /* A match is played to a total. A level game is never the end of it:
       somebody has to be ahead when the lights go out. */
    const lead = this.scores[0] === this.scores[1] ? null : (this.scores[0] > this.scores[1] ? 0 : 1);
    if (lead !== null && this.scores[lead] >= this.target) {
      this.matchOver = true;
      this.ended.match = lead;
    }
  } else {
    this.matchOver = true;
    this.ended.match = winner;
  }
  return 0;
};

SixesGame.prototype.nextGame = function () {
  if (this.phase !== 'ended' || this.matchOver) return;
  const first = this.ended.winner === null ? this.turn : 1 - this.ended.winner;
  const scores = this.scores.slice(), wins = this.wins.slice();
  this.startGame(first);
  this.scores = scores; this.wins = wins;
};

SixesGame.prototype.growBounds = function (played) {
  for (const x of played) {
    if (this.bounds.empty) {
      this.bounds = { r0: x.r, r1: x.r, c0: x.c, c1: x.c, empty: false };
    } else {
      this.bounds.r0 = Math.min(this.bounds.r0, x.r);
      this.bounds.r1 = Math.max(this.bounds.r1, x.r);
      this.bounds.c0 = Math.min(this.bounds.c0, x.c);
      this.bounds.c1 = Math.max(this.bounds.c1, x.c);
    }
  }
};

/* Every empty square touching a tile — the only squares worth trying. */
SixesGame.prototype.openSquares = function () {
  if (this.isEmpty()) return [{ r: 0, c: 0 }];
  const seen = new Set(), out = [];
  for (const k of Object.keys(this.board)) {
    const parts = k.split(',');
    const r = parseInt(parts[0], 10), c = parseInt(parts[1], 10);
    for (const d of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const rr = r + d[0], cc = c + d[1];
      const kk = key(rr, cc);
      if (this.board[kk] || seen.has(kk)) continue;
      seen.add(kk);
      out.push({ r: rr, c: cc });
    }
  }
  return out;
};

SixesGame.prototype.hasAnyPlay = function (p) {
  if (this.placed.length) return true;
  const squares = this.openSquares();
  for (const t of this.hands[p]) {
    for (const sq of squares) {
      /* canPlace refuses when it is not your turn, which is the wrong
         question here: this asks whether a move exists at all. */
      const keep = this.turn;
      this.turn = p;
      const v = this.canPlace(p, t.id, sq.r, sq.c);
      this.turn = keep;
      if (v.ok) return true;
    }
  }
  return false;
};

/* ---------- node and the browser ----------
   In a browser these are plain top-level declarations, which means the
   functions are reachable as globals but the consts are not. Anything the
   table or the opponent needs by name is published deliberately. */
if (typeof window !== 'undefined') {
  window.SixesGame = SixesGame;
  window.COLORS = COLORS; window.SHAPES = SHAPES; window.COLOR_NAME = COLOR_NAME;
  window.HAND_SIZE = HAND_SIZE; window.LINE_MAX = LINE_MAX;
  window.SIX_BONUS = SIX_BONUS; window.OUT_BONUS = OUT_BONUS;
  window.sixesTileName = tileName;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SixesGame: SixesGame, makeBag: makeBag, shuffle: shuffle, runOk: runOk,
    COLORS: COLORS, SHAPES: SHAPES, COLOR_NAME: COLOR_NAME, tileName: tileName,
    HAND_SIZE: HAND_SIZE, LINE_MAX: LINE_MAX, SIX_BONUS: SIX_BONUS, OUT_BONUS: OUT_BONUS
  };
}
})();
