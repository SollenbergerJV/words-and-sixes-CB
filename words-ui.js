'use strict';
/* ============================================================
   WORD SQUARES — the table.

   The same shape as the Sixes table, and for the same reason: one
   screen draws a game against the computer, a game passed between two
   people on one device, and a game served from the other side of the
   country, because all three are just a position and a seat.

   Everything here reads WG for the position and wViewer for the side
   of the table. When the game is local, WG is the real WordGame and
   the rules can be asked questions directly. When it is online, WG is
   a redacted snapshot and the server answers instead.
   ============================================================ */

let WG = null;          // a WordGame when offline, a served view when online
let WLIVE = null;       // the real game object when offline
let wViewer = 0;
let wBot = null;
let wBotTimer = null;
let wPicked = null;     // the rack tile lifted
let wSwapping = null;   // a Set of ids while choosing what to swap
let wTrie = null;       // the dictionary, once loaded
let wDictState = 'none'; // 'none' | 'loading' | 'ready' | 'failed'

const WSIZE = 15;

/* ---------- the dictionary ----------
   A megabyte of words, so it is fetched once and only when a word game
   is actually starting. The game can begin before it arrives: nothing
   needs it until somebody challenges. */
function loadDictionary(then) {
  if (wDictState === 'ready') { if (then) then(wTrie); return; }
  if (wDictState === 'loading') return;
  wDictState = 'loading';
  fetch('/words.txt')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (text) {
      wTrie = new WordTrie().build(text);
      wDictState = 'ready';
      if (WLIVE) WLIVE.dict = wTrie;
      if (wBot) wBot.setDictionary(wTrie);
      if (WG) wRender();
      if (then) then(wTrie);
    })
    .catch(function (e) {
      wDictState = 'failed';
      wShowFault('the word list could not be loaded (' + e.message + '), so no word can be challenged');
    });
}
function wShowFault(what) {
  if (typeof showFault === 'function') showFault(what);
}

/* ---------- starting ---------- */
function startWordGame() {
  S.names = [
    ($('#n0').value || 'You').trim().slice(0, 14) || 'You',
    S.mode === 'ai' ? 'Computer' : (($('#n1').value || 'Opponent').trim().slice(0, 14) || 'Opponent')
  ];
  saveSettings();

  const begin = function () {
    WLIVE = new WordGame({ names: S.names.slice(), dict: wTrie || { has: function () { return true; } } });
    WG = WLIVE;
    wViewer = 0;
    wBot = (S.mode === 'ai' && typeof WordAI === 'function') ? new WordAI(S.diff, wTrie) : null;
    wPicked = null; wSwapping = null; wLastWin = null;
    showScreen('words');
    wRender();
    wMaybeBot();
  };

  /* Against the computer the dictionary is not optional — it is what the
     opponent thinks with — so that one game waits for it. */
  if (S.mode === 'ai' && wDictState !== 'ready') {
    showScreen('words');
    const box = $('#wdMsg');
    if (box) box.textContent = 'Fetching the word list…';
    loadDictionary(begin);
    return;
  }
  loadDictionary();
  begin();
}

function wApplyServerState(v) {
  WG = v;
  WLIVE = null;
  wBot = null;
  wViewer = v.you;
  if (wDictState === 'none') loadDictionary();
  if (wPicked && !(v.racks[wViewer] || []).some(function (t) { return t.id === wPicked; })) wPicked = null;
  showScreen('words');
  wRender();
}

/* ---------- reading the position ---------- */
function wMyRack() {
  if (!WG) return [];
  return (WLIVE ? WLIVE.racks[wViewer] : WG.racks[wViewer]) || [];
}
function wMyTurn() { return WG && WG.turn === wViewer && WG.phase === 'play'; }
function wPlacedCount() { return WLIVE ? WLIVE.placed.length : (WG ? WG.placed.length : 0); }
function wPending() { return WLIVE ? WLIVE.turnScore() : (WG ? WG.pending : 0); }
function wBagCount() { return WLIVE ? WLIVE.bag.length : (WG ? WG.bagCount : 0); }
function wCanChallenge() {
  if (WLIVE) return WLIVE.canChallenge(wViewer);
  return !!(WG && WG.canChallenge);
}
function wOpenPlay() { return WLIVE ? WLIVE.open : (WG ? WG.open : null); }

function wBoardTiles() {
  const out = [];
  if (WLIVE) {
    for (const k of Object.keys(WLIVE.board)) {
      const b = k.split(',');
      const t = WLIVE.board[k];
      out.push({ r: +b[0], c: +b[1], ch: t.ch, v: t.v, blank: !!t.blank });
    }
    for (const p of WLIVE.placed) {
      out.push({ r: p.r, c: p.c, ch: p.tile.ch, v: p.tile.v, blank: !!p.tile.blank, fresh: true, id: p.tile.id });
    }
  } else if (WG) {
    for (const t of WG.board) out.push({ r: t.r, c: t.c, ch: t.ch, v: wValue(t.ch, t.blank), blank: t.blank });
    for (const t of WG.placed) out.push({ r: t.r, c: t.c, ch: t.ch, v: wValue(t.ch, t.blank), blank: t.blank, fresh: true, id: t.id });
  }
  return out;
}
function wValue(ch, blank) {
  if (blank) return 0;
  const L = window.WORD_LETTERS || {};
  return L[ch] ? L[ch].v : 0;
}

/* ---------- drawing ---------- */
function wTileNode(ch, v, blank) {
  const n = el('div', 'wtile' + (blank ? ' blank' : ''));
  n.appendChild(document.createTextNode(ch));
  if (!blank) {
    const s = el('span', 'val', String(v));
    n.appendChild(s);
  }
  return n;
}

function wRender() {
  if (!WG) return;
  wRenderScore();
  wRenderOpp();
  wRenderBoard();
  wRenderRack();
  wRenderActions();
  wRenderMsg();
  requestAnimationFrame(function () { wFitBoard(); });
}

function wRenderScore() {
  const box = $('#wdScore');
  if (!box) return;
  const sc = WG.scores || [0, 0];
  const lead = sc[0] === sc[1] ? -1 : (sc[0] > sc[1] ? 0 : 1);
  box.innerHTML = '';
  for (const p of [0, 1]) {
    const side = el('span', 'side' + (lead === p ? ' lead' : ''));
    side.innerHTML = esc(p === wViewer ? 'You' : wNameOf(p)) + ' <b>' + sc[p] + '</b>';
    box.appendChild(side);
    if (p === 0) box.appendChild(el('span', 'vs', 'vs'));
  }
}

function wNameOf(p) { return nameOf(p); }

function wRenderOpp() {
  const seat = $('#wdOppSeat');
  if (!seat) return;
  const them = 1 - wViewer;
  const n = WG.rackCounts ? WG.rackCounts[them] : (WLIVE ? WLIVE.racks[them].length : 0);
  let note = '';
  const last = WG.lastPlay;
  if (last && last.who === them) {
    if (last.kind === 'played') note = ' · played ' + (last.words || []).join(', ') + ' for ' + last.score;
    else if (last.kind === 'swapped') note = ' · swapped ' + last.count;
    else if (last.kind === 'passed') note = ' · passed';
    else if (last.kind === 'challenge-won') note = ' · challenged, and was right';
    else if (last.kind === 'challenge-lost') note = ' · challenged, and lost ' + last.cost;
  }
  seat.textContent = wNameOf(them) + ' · ' + n + ' tile' + (n === 1 ? '' : 's') + note;
}

function wRenderBoard() {
  const board = $('#wdBoard');
  if (!board) return;
  const tiles = wBoardTiles();
  const byKey = {};
  for (const t of tiles) byKey[t.r + ',' + t.c] = t;

  board.innerHTML = '';
  const PREM = window.WORD_PREMIUMS;
  const LABEL = { d: 'DL', t: 'TL', D: 'DW', T: 'TW', C: '★' };

  for (let r = 0; r < WSIZE; r++) {
    for (let c = 0; c < WSIZE; c++) {
      const t = byKey[r + ',' + c];
      if (t) {
        const n = wTileNode(t.ch, t.v, t.blank);
        if (t.fresh) {
          n.classList.add('fresh');
          n.title = 'Tap to take this tile back';
          n.onclick = function () { wTakeBack(t.id); };
        }
        board.appendChild(n);
        continue;
      }
      const prem = PREM ? PREM[r][c] : '.';
      const cell = el('div', 'wcell');
      if (prem !== '.') {
        cell.dataset.p = prem;
        cell.textContent = LABEL[prem] || '';
      }
      if (wPicked && wMyTurn() && wCanDrop(r, c)) cell.classList.add('open');
      cell.onclick = function () { wDropAt(r, c); };
      board.appendChild(cell);
    }
  }
}

/* Which squares are worth offering.

   The rules only refuse a square outright for a few reasons — it is
   taken, or it is out of line with the rest of the turn — and leave the
   real test until the whole word is submitted. That is right for the
   rules and wrong for the screen: a board where every empty square
   lights up invites you to build a word somewhere it can never be
   played, and then refuses it at the end. So the highlighting answers
   the stricter question: could a tile here be part of a legal play? */
function wCanDrop(r, c) {
  if (!wPicked) return false;
  if (WLIVE) {
    const tile = WLIVE.racks[wViewer].find(function (t) { return t.id === wPicked; });
    const letter = tile && tile.ch === '?' ? 'a' : undefined;
    if (!WLIVE.canPlace(wViewer, wPicked, r, c, letter).ok) return false;
  }

  /* Mid-turn the line is already fixed, and the rules have just checked
     this square is on it. */
  if (wPlacedCount()) return true;

  const tiles = wBoardTiles();
  if (!tiles.length) {
    /* The first word has to cross the middle, and everything in a turn
       goes in one line, so that line runs through the middle square. */
    const MIDS = 7;
    return (r === MIDS && Math.abs(c - MIDS) <= 6) || (c === MIDS && Math.abs(r - MIDS) <= 6);
  }

  const taken = {};
  for (const t of tiles) taken[t.r + ',' + t.c] = true;
  return [[0, 1], [0, -1], [1, 0], [-1, 0]].some(function (d) {
    return taken[(r + d[0]) + ',' + (c + d[1])];
  });
}

function wRenderRack() {
  const box = $('#wdRack');
  if (!box) return;
  box.innerHTML = '';
  for (const t of wMyRack()) {
    const blank = t.ch === '?';
    const n = wTileNode(blank ? ' ' : t.ch, t.v, blank);
    n.dataset.id = t.id;
    if (wPicked === t.id) n.classList.add('picked');
    if (wSwapping && wSwapping.has(t.id)) n.classList.add('swapping');
    n.onclick = function () { wTapRack(t.id); };
    box.appendChild(n);
  }
  const bag = $('#wdBag');
  if (bag) bag.innerHTML = 'Bag <b>' + wBagCount() + '</b>';
  const pend = $('#wdPending');
  if (pend) {
    const n = wPlacedCount() ? wPending() : 0;
    pend.hidden = !wPlacedCount();
    pend.innerHTML = 'This turn <b>' + n + '</b>';
  }
}

function wRenderActions() {
  const box = $('#wdActions');
  if (!box) return;
  box.innerHTML = '';
  const add = function (label, fn, cls) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.onclick = fn;
    box.appendChild(b);
    return b;
  };

  if (WG.phase === 'ended') {
    add('Play again', function () { wAgain(); }, 'primary');
    add('Leave', wLeave);
    return;
  }
  if (!wMyTurn()) return;

  if (wSwapping) {
    add('Swap these ' + wSwapping.size, function () { wDoSwap(); }, wSwapping.size ? 'primary' : '');
    add('Cancel', function () { wSwapping = null; wRender(); });
    return;
  }

  if (wPlacedCount()) {
    const check = WLIVE ? WLIVE.checkPlacement() : { ok: true };
    if (check.ok) {
      add('Play it — ' + wPending(), function () { wSubmit(); }, 'primary');
    } else {
      /* Offering a button that is going to be refused teaches nothing.
         The reason is on the line above instead. */
      const b = add('Play it', function () {}, '');
      b.disabled = true;
    }
    add('Take back', function () { wTakeBackAll(); });
    return;
  }

  /* A challenge is only on the table before you have done anything else
     with your turn, so it sits here with the other openings. */
  if (wCanChallenge()) {
    const open = wOpenPlay();
    const words = open && open.words ? open.words.join(', ') : 'that';
    add('Challenge ' + words, function () { wChallenge(); });
  }
  if (wBagCount()) add('Swap tiles', function () { wSwapping = new Set(); wRender(); });
  add('Pass', function () { wPass(); });
}

function wRenderMsg() {
  const box = $('#wdMsg');
  if (!box) return;
  let main = '';
  const them = 1 - wViewer;

  if (WG.phase === 'ended') {
    const e = WG.ended || {};
    if (e.level) main = 'A tie — ' + (WG.scores || [])[0] + ' each';
    else main = (e.winner === wViewer ? 'You win' : wNameOf(e.winner) + ' wins') +
      ', ' + (WG.scores || [])[e.winner] + ' to ' + (WG.scores || [])[1 - e.winner];
  } else if (isOnline() && WG.turn !== wViewer) {
    main = PEER_HERE ? 'Waiting for ' + wNameOf(them) : wNameOf(them) + ' has dropped out';
  } else if (WG.turn !== wViewer) {
    main = wNameOf(them) + ' is thinking…';
  } else if (wSwapping) {
    main = wSwapping.size ? 'Swapping ' + wSwapping.size : 'Tap the tiles you want to swap';
  } else if (wPicked) {
    main = 'Tap a square to put it down';
  } else if (wPlacedCount()) {
    const check = WLIVE ? WLIVE.checkPlacement() : { ok: true };
    main = check.ok ? 'Add more letters, or play it' : check.why;
  } else if (wCanChallenge()) {
    const open = wOpenPlay();
    main = 'They played ' + ((open && open.words) || []).join(', ') + ' — challenge it, or take your turn';
  } else {
    main = 'Your turn';
  }
  box.textContent = main;
}

/* ---------- fitting the board ---------- */
function wFitBoard() {
  const screen = $('#screen-words');
  if (!screen || screen.hidden) return;
  const board = $('#wdBoard'), scroll = $('#wdScroll');
  if (!board || !scroll) return;
  const h = function (sel) { const e = screen.querySelector(sel); return e ? e.offsetHeight : 0; };

  const CHROME = 58;
  const room = screen.clientHeight - h('.topbar') - h('.oppzone') - h('.handmeta') -
    h('.rack') - h('.actions') - Math.max(20, h('#wdMsg')) - CHROME;
  const wide = scroll.clientWidth - 14;
  const gap = 2;
  const byHeight = (Math.max(150, room) - 16 * gap) / 15;
  const byWidth = (wide - 16 * gap) / 15;
  /* Below about twenty pixels a letter cannot be read, so the board stops
     shrinking there and the area scrolls instead. */
  const size = Math.max(21, Math.min(44, Math.floor(Math.min(byHeight, byWidth))));
  board.style.setProperty('--wsq', size + 'px');
}
window.addEventListener('resize', function () { requestAnimationFrame(wFitBoard); });
let wLastWin = null;

/* ---------- playing ---------- */
function wTapRack(id) {
  if (!wMyTurn()) return;
  if (wSwapping) {
    if (wSwapping.has(id)) wSwapping.delete(id); else wSwapping.add(id);
    sfx.tap();
    wRender();
    return;
  }
  wPicked = (wPicked === id) ? null : id;
  sfx.tap();
  wRender();
}

function wDropAt(r, c) {
  if (!wMyTurn() || !wPicked) return;
  const id = wPicked;
  const tile = wMyRack().find(function (t) { return t.id === id; });
  if (tile && tile.ch === '?') { wAskLetter(function (ch) { wPut(id, r, c, ch); }); return; }
  wPut(id, r, c);
}

function wPut(id, r, c, letter) {
  if (WLIVE) {
    const v = WLIVE.canPlace(wViewer, id, r, c, letter);
    if (!v.ok) { sfx.bad(); wFlash(v.why); return; }
    WLIVE.place(wViewer, id, r, c, letter);
    wPicked = null;
    sfx.place();
    wRender();
  } else {
    wPicked = null;
    NET.act({ t: 'action', do: 'place', tileId: id, r: r, c: c, letter: letter });
  }
}

/* A blank is whatever you say it is, so you have to say. */
function wAskLetter(then) {
  const sheet = openOverlay('<h2>What is this blank?</h2><p>Pick the letter it stands for. It scores nothing either way.</p><div class="letters" id="letterGrid"></div>');
  const grid = sheet.querySelector('#letterGrid');
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    const b = el('button', '', ch);
    b.onclick = function () { closeOverlay(); then(ch); };
    grid.appendChild(b);
  }
}

function wTakeBack(id) {
  if (!wMyTurn()) return;
  if (WLIVE) { WLIVE.unplace(wViewer, id); sfx.tap(); wRender(); }
  else NET.act({ t: 'action', do: 'unplace', tileId: id });
}
function wTakeBackAll() {
  if (!wMyTurn()) return;
  if (WLIVE) { WLIVE.takeBackAll(wViewer); sfx.tap(); wRender(); }
  else NET.act({ t: 'action', do: 'clear' });
}

function wSubmit() {
  if (!wMyTurn() || !wPlacedCount()) return;
  if (WLIVE) {
    let gained;
    try { gained = WLIVE.submit(wViewer); }
    catch (e) { sfx.bad(); wFlash(e.message); return; }
    if (gained >= 30) sfx.score(); else sfx.place();
    wPicked = null;
    wRender();
    wMaybeBot();
  } else {
    NET.act({ t: 'action', do: 'submit' });
  }
}

function wDoSwap() {
  if (!wSwapping || !wSwapping.size) { wFlash('Tap the tiles you want to swap first.'); return; }
  const ids = Array.from(wSwapping);
  wSwapping = null;
  if (WLIVE) {
    try { WLIVE.swap(wViewer, ids); } catch (e) { sfx.bad(); wFlash(e.message); wRender(); return; }
    wRender();
    wMaybeBot();
  } else {
    NET.act({ t: 'action', do: 'swap', ids: ids });
  }
}

function wPass() {
  if (!wMyTurn()) return;
  if (WLIVE) {
    try { WLIVE.pass(wViewer); } catch (e) { sfx.bad(); wFlash(e.message); return; }
    wRender();
    wMaybeBot();
  } else {
    NET.act({ t: 'action', do: 'pass' });
  }
}

function wChallenge() {
  if (!wCanChallenge()) return;
  if (WLIVE) {
    let r;
    try { r = WLIVE.challenge(wViewer); } catch (e) { sfx.bad(); wFlash(e.message); return; }
    wFlash(r.upheld
      ? 'Right — ' + r.words.join(', ') + ' is not in the dictionary, so it comes back'
      : 'It stands, and that costs you ' + r.cost);
    wRender();
  } else {
    NET.act({ t: 'action', do: 'challenge' });
  }
}

function wFlash(text) {
  const box = $('#wdMsg');
  if (!box) return;
  box.textContent = text;
  setTimeout(function () { wRender(); }, 2600);
}

/* ---------- the computer's turn ---------- */
function wMaybeBot() {
  clearTimeout(wBotTimer);
  if (!WLIVE || !wBot) return;
  if (WLIVE.phase !== 'play' || WLIVE.turn !== 1) return;
  wBotTimer = setTimeout(wPlayBot, 700);
}

function wPlayBot() {
  if (!WLIVE || !wBot || WLIVE.turn !== 1 || WLIVE.phase !== 'play') return;

  /* It gets its challenge in before its own move, the same as a person. */
  if (WLIVE.canChallenge(1) && wBot.wantsChallenge(WLIVE, 1)) {
    const r = WLIVE.challenge(1);
    wFlash(r.upheld
      ? wNameOf(1) + ' challenged — ' + r.words.join(', ') + ' is not a word'
      : wNameOf(1) + ' challenged and was wrong, losing ' + r.cost);
    wRender();
    wBotTimer = setTimeout(wPlayBot, 1400);
    return;
  }

  const d = wBot.decide(WLIVE, 1, 10000);
  if (d.kind === 'play') {
    for (const t of d.move.tiles) {
      try { WLIVE.place(1, t.id, t.r, t.c, t.blank ? t.ch : undefined); } catch (e) {}
    }
    wRender();
    wBotTimer = setTimeout(function () {
      if (!WLIVE || WLIVE.turn !== 1) return;
      try { WLIVE.submit(1); } catch (e) { WLIVE.takeBackAll(1); WLIVE.pass(1); }
      sfx.place();
      wRender();
      wMaybeBot();
    }, 900);
    return;
  }
  if (d.kind === 'swap') { try { WLIVE.swap(1, d.ids); } catch (e) { WLIVE.pass(1); } }
  else { WLIVE.pass(1); }
  wRender();
  wMaybeBot();
}

function wLeave() {
  clearTimeout(wBotTimer);
  if (isOnline()) { NET.leave(); ONLINE = false; }
  WLIVE = null; WG = null; wPicked = null; wSwapping = null;
  showScreen('lobby');
}
function wAgain() {
  if (isOnline()) { NET.rematch(); return; }
  startWordGame();
}

function wShowRules() {
  openOverlay(
    '<h2>Word Squares</h2>' +
    '<p>Seven letters on your rack, a board fifteen squares across. Make words, cross them, and score.</p>' +
    '<section><h3>Your turn</h3>' +
    '<p>Tap a letter, then tap the square you want it on. Everything you play in one turn goes in <b>one straight line</b> with no gaps. Tap a letter you have just put down to take it back — nothing counts until you press <b>Play it</b>.</p>' +
    '<p>The first word of the game has to cross the <b>★</b> in the middle. After that, every word has to touch what is already down.</p></section>' +
    '<section><h3>Scoring</h3>' +
    '<p>Each letter is worth its number. <b>DL</b> and <b>TL</b> double and triple that letter; <b>DW</b> and <b>TW</b> double and triple the whole word. A bonus square only counts on the turn a tile lands on it, and the middle square counts as a double word.</p>' +
    '<p>You score every word your turn makes, not just the long one — the little ones your letters form sideways all count. Use all seven letters in one turn and you get <b>fifty more</b>.</p></section>' +
    '<section><h3>Blanks</h3>' +
    '<p>Two tiles are blank. A blank can be any letter — you say which as you put it down — but it is worth nothing.</p></section>' +
    '<section><h3>Challenging</h3>' +
    '<p>A word the dictionary does not know is <b>not refused</b>. You can play it, and the other player can challenge it on their turn.</p>' +
    '<p>If they are right, your letters come back and the play scores nothing. If they are wrong, it costs them <b>ten points</b>.</p>' +
    '<p>The dictionary has about 111,000 words in it and no names or abbreviations, but it is not the last word on English — which is exactly why challenging is a choice rather than something the app does for you.</p></section>' +
    '<section><h3>The end</h3>' +
    '<p>Swap tiles or pass instead of playing, if you are stuck. When the bag is empty and somebody uses their last letter, the game ends and they take what is left on the other rack. Highest score wins.</p></section>'
  );
}

/* A window onto the state for the tests. */
window.wordsState = function () {
  if (!WG) return null;
  return {
    turn: WG.turn, viewer: wViewer, phase: WG.phase,
    rack: wMyRack().length, bag: wBagCount(),
    placed: wPlacedCount(), pending: wPending(),
    scores: (WG.scores || []).slice(),
    tiles: wBoardTiles().length,
    canChallenge: wCanChallenge(),
    dict: wDictState,
    online: isOnline()
  };
};

function initWords() {
  const back = $('#wdBack'); if (back) back.onclick = guard(wLeave);
  const rules = $('#wdRules'); if (rules) rules.onclick = wShowRules;
  const set = $('#wdSettings'); if (set) set.onclick = showSettings;
}
initWords();
