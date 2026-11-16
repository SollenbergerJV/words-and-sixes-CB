'use strict';
/* ============================================================
   Rooms, seats and the authoritative game.

   The server owns the bag. Neither player's browser is ever sent the
   other player's tiles — not hidden in the page, not in memory — so
   cheating is removed as a category rather than discouraged as a
   policy, and the two screens can never disagree about the position.

   Written with a second game in mind: everything game-specific is
   behind startMatch / viewFor / applyAction, so adding the word game
   later means three small additions here and nothing else.
   ============================================================ */
function rules(name) {
  /* An upload through a browser file-picker flattens folders, and then
     ../shared/ does not exist. Both layouts have to work. */
  try { return require('../shared/' + name); } catch (e) { return require('./' + name); }
}
const { SixesGame } = rules('sixes.js');
const { WordGame } = rules('words.js');
const WordTrie = rules('word-trie.js');

/* ---------- the dictionary, once ----------
   Only the server needs it to settle a challenge, and only a word game
   needs it at all, so it is read the first time one starts rather than
   at boot. */
let DICT = null;
function dictionary() {
  if (DICT) return DICT;
  const fs = require('fs'), path = require('path');
  const tries = [
    path.join(__dirname, '..', 'public', 'words.txt'),
    path.join(__dirname, 'words.txt')
  ];
  for (const f of tries) {
    try {
      DICT = new WordTrie().build(fs.readFileSync(f, 'utf8'));
      console.log('dictionary loaded: ' + DICT.size() + ' words');
      return DICT;
    } catch (e) { /* try the next layout */ }
  }
  /* Rather than refuse to start a game, run without one: every word then
     stands, because no challenge can be upheld. Said out loud, because
     silently changing the rules would be worse than the missing file. */
  console.error('words.txt was not found — word games will run with no dictionary, so no challenge can succeed');
  DICT = { has: function () { return true; }, size: function () { return 0; } };
  return DICT;
}

/* No 0/O/1/I/5/S — codes get read aloud down a phone. */
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
const CODE_LEN = 5;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;   // an abandoned room evaporates
const GRACE_MS = 2 * 60 * 1000;            // how long a dropped player keeps their seat

function randInt(n) {
  const b = require('crypto').randomBytes(4).readUInt32BE(0);
  return b % n;
}
function token() { return require('crypto').randomBytes(16).toString('hex'); }

function Rooms() {
  this.byCode = new Map();
  this.bySeat = new Map();
}

Rooms.prototype.newCode = function () {
  for (let attempt = 0; attempt < 500; attempt++) {
    let c = '';
    for (let i = 0; i < CODE_LEN; i++) c += ALPHABET[randInt(ALPHABET.length)];
    if (!this.byCode.has(c)) return c;
  }
  throw new Error('could not mint a room code');
};

Rooms.prototype.create = function (opts) {
  const code = this.newCode();
  const room = {
    code: code,
    game: opts.game === 'words' ? 'words' : 'sixes',
    target: Number.isFinite(opts.target) ? opts.target : 0,
    seats: [null, null],
    G: null,
    names: ['Player 1', 'Player 2'],
    started: false,
    touched: Date.now(),
    chat: []
  };
  this.byCode.set(code, room);
  return room;
};

Rooms.prototype.sit = function (room, name, seatIdx) {
  const t = token();
  room.seats[seatIdx] = {
    token: t, name: name, conn: null, connected: false,
    droppedAt: 0, idx: seatIdx, room: room
  };
  room.names[seatIdx] = name;
  this.bySeat.set(t, room.seats[seatIdx]);
  room.touched = Date.now();
  return room.seats[seatIdx];
};

Rooms.prototype.get = function (code) {
  return this.byCode.get(String(code || '').toUpperCase().trim()) || null;
};
Rooms.prototype.seat = function (t) { return this.bySeat.get(t) || null; };

Rooms.prototype.destroy = function (room) {
  for (const s of room.seats) if (s) this.bySeat.delete(s.token);
  this.byCode.delete(room.code);
};

Rooms.prototype.sweep = function () {
  const now = Date.now();
  for (const room of Array.from(this.byCode.values())) {
    if (now - room.touched > ROOM_IDLE_MS) { this.destroy(room); continue; }
    const live = room.seats.filter(function (s) { return s && (s.connected || now - s.droppedAt < GRACE_MS); });
    if (room.started && live.length === 0) this.destroy(room);
  }
};

/* ---------- starting ---------- */
function startMatch(room) {
  room.names = [
    room.seats[0] ? room.seats[0].name : 'Player 1',
    room.seats[1] ? room.seats[1].name : 'Player 2'
  ];
  room.G = room.game === 'words'
    ? new WordGame({ names: room.names.slice(), dict: dictionary(), first: 0 })
    : new SixesGame({ target: room.target, first: 0 });
  room.started = true;
  room.touched = Date.now();
}

/* ---------- the per-seat view ----------
   The same field names the offline game uses, so the table code draws a
   served position and a local one without branching. The other player's
   tiles become blanks that still count, which is all the table asks of
   them, and the bag becomes a number. */
function blanks(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ hidden: true, id: 'x' + i, c: 'R', s: 'circle' });
  return out;
}

function viewFor(room, p) {
  if (!room.G) return null;
  return room.game === 'words' ? viewWords(room, p) : viewSixes(room, p);
}

/* ---------- the word game, per seat ----------
   The other rack is a count, never letters, and the bag is a number. */
function viewWords(room, p) {
  const G = room.G;
  const them = 1 - p;
  const mine = G.turn === p;

  const board = [];
  for (const k of Object.keys(G.board)) {
    const bits = k.split(',');
    const t = G.board[k];
    board.push({ r: parseInt(bits[0], 10), c: parseInt(bits[1], 10), ch: t.ch, blank: !!t.blank });
  }

  return {
    kind: 'words',
    you: p,
    names: room.names.slice(),
    scores: G.scores.slice(),
    turn: G.turn,
    phase: G.phase,
    racks: [
      p === 0 ? G.racks[0].map(function (t) { return { id: t.id, ch: t.ch, v: t.v }; }) : null,
      p === 1 ? G.racks[1].map(function (t) { return { id: t.id, ch: t.ch, v: t.v }; }) : null
    ],
    rackCounts: [G.racks[0].length, G.racks[1].length],
    bagCount: G.bag.length,
    board: board,
    placed: mine ? G.placed.map(function (x) {
      return { r: x.r, c: x.c, ch: x.tile.ch, blank: !!x.tile.blank, id: x.tile.id };
    }) : [],
    pending: mine ? G.turnScore() : 0,
    lastPlay: G.lastPlay,
    /* What may still be challenged, and by whom. The words themselves are
       public — they are sitting on the board. */
    open: G.open ? { by: G.open.by, words: G.open.words, score: G.open.score } : null,
    canChallenge: G.canChallenge(p),
    ended: G.ended,
    matchOver: G.phase === 'ended'
  };
}

function viewSixes(room, p) {
  const G = room.G;
  const them = 1 - p;
  const mine = G.turn === p;

  const hands = [];
  hands[p] = G.hands[p].map(function (t) { return { id: t.id, c: t.c, s: t.s }; });
  hands[them] = blanks(G.hands[them].length);

  /* The board as a flat list rather than an object: it survives JSON
     with its numbers intact and is cheap to draw straight through. */
  const board = [];
  for (const k of Object.keys(G.board)) {
    const bits = k.split(',');
    const t = G.board[k];
    board.push({ r: parseInt(bits[0], 10), c: parseInt(bits[1], 10), col: t.c, s: t.s });
  }

  return {
    kind: 'sixes',
    you: p,
    names: room.names.slice(),
    scores: G.scores.slice(),
    gameScores: G.gameScores.slice(),
    wins: G.wins.slice(),
    target: G.target,
    turn: G.turn,
    phase: G.phase,
    hands: hands,
    handCounts: [G.hands[0].length, G.hands[1].length],
    bagCount: G.bag.length,
    board: board,
    bounds: G.bounds,
    /* Tiles put down but not yet committed can still be taken back, so
       they are nobody's business but the player holding them. */
    placed: mine ? G.placed.map(function (x) {
      return { r: x.r, c: x.c, col: x.tile.c, s: x.tile.s, id: x.tile.id };
    }) : [],
    pending: mine ? G.turnScore() : 0,
    /* Whether this player has any legal move at all. The client cannot
       work this out for itself — it cannot see the board's full state
       against a hand it does not hold — and without it there is no way to
       know whether to offer the Pass button. */
    mustPass: mine ? G.mustPass(p) : false,
    lastTurn: G.lastTurn,
    ended: G.ended,
    matchOver: G.matchOver
  };
}

/* ---------- applying an action ----------
   Every one is a rules call that throws when it is not allowed, so an
   edited client gets an error back and the position is left untouched. */
function applySixes(G, p, a) {
  switch (a.do) {
    case 'place':   G.place(p, String(a.tileId), a.r | 0, a.c | 0); return;
    case 'unplace': G.unplace(p, String(a.tileId)); return;
    case 'clear':   G.takeBackAll(p); return;
    case 'commit':  G.commit(p); return;
    case 'swap':    G.swap(p, Array.isArray(a.ids) ? a.ids.map(String) : []); return;
    case 'pass':    G.pass(p); return;
    default: throw new Error('unknown action');
  }
}

function applyWords(G, p, a) {
  switch (a.do) {
    case 'place':   G.place(p, String(a.tileId), a.r | 0, a.c | 0, a.letter); return;
    case 'unplace': G.unplace(p, String(a.tileId)); return;
    case 'clear':   G.takeBackAll(p); return;
    case 'submit':  G.submit(p); return;
    case 'swap':    G.swap(p, Array.isArray(a.ids) ? a.ids.map(String) : []); return;
    case 'pass':    G.pass(p); return;
    default: throw new Error('unknown action');
  }
}

function applyAction(room, p, a) {
  const G = room.G;
  if (!G) throw new Error('the game has not started');
  if (room.game === 'words') {
    if (G.phase === 'ended') throw new Error('the game is over');
    /* A challenge is the one thing you do on your turn before doing
       anything else with it, so it is checked before the turn test. */
    if (a.do === 'challenge') { G.challenge(p); return; }
    if (G.turn !== p) throw new Error('not your turn');
    applyWords(G, p, a);
    return;
  }
  if (G.matchOver) throw new Error('the match is over');
  if (a.do === 'next') {
    // either player may start the next game; whoever asks second is a no-op
    if (G.phase !== 'ended') return;
    G.nextGame();
    return;
  }
  if (G.phase === 'ended') throw new Error('the game is over');
  if (G.turn !== p) throw new Error('not your turn');
  applySixes(G, p, a);
}

module.exports = {
  Rooms: Rooms, startMatch: startMatch, viewFor: viewFor, applyAction: applyAction,
  GRACE_MS: GRACE_MS, ALPHABET: ALPHABET, CODE_LEN: CODE_LEN
};
