'use strict';
/* ============================================================
   WORD SQUARES — the computer opponent.

   Finding a move is the whole job, and the trick is to stop looking
   early. There are 15x15 squares, seven tiles, and two directions; try
   every arrangement and you are still going when the kettle has boiled.
   Three things cut that down to something sensible, and they are the
   standard three:

   ANCHORS. A word has to touch what is already on the board, so only
   the empty squares next to a letter are worth starting from — a
   handful, not two hundred.

   CROSS-CHECKS. Before searching, work out for every empty square which
   letters would make a real word in the OTHER direction. Most squares
   allow only a few letters, and some allow none at all. Checking that
   once per square beats rediscovering it inside the search.

   THE TRIE. Walking the dictionary letter by letter means a branch dies
   the moment the letters so far spell nothing — "qz" is abandoned after
   two tiles rather than after seven.

   The three settings are not three algorithms. All of them search the
   same way; they differ in which move they then choose, which is how a
   person differs from a better person at this game.
   ============================================================ */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./words.js'));
  } else {
    root.WordAI = factory({
      SIZE: root.WORD_SIZE || 15, RACK: root.WORD_RACK || 7,
      premiumAt: function (r, c) { return root.WORD_PREMIUMS[r][c]; },
      BINGO: 50
    });
  }
}(typeof self !== 'undefined' ? self : this, function (W) {

  const SIZE = W.SIZE || 15;
  const RACK = W.RACK || 7;
  const MID = 7;
  const A = 97;
  const ALL = (1 << 26) - 1;

  function idx(ch) { return ch.toLowerCase().charCodeAt(0) - A; }
  function letter(i) { return String.fromCharCode(A + i).toUpperCase(); }

  /* ---------- settings ----------
     Sharp plays the highest-scoring move it can find. Steady and Easy
     look at the same list and pick further down it, and Easy will not
     consider the longest words at all — which is what it actually looks
     like when somebody is not very good at this: they miss the big one,
     not the rules. */
  const LEVELS = {
    easy:   { maxTiles: 4, pick: 0.45, cap: 24 },
    steady: { maxTiles: 6, pick: 0.2, cap: 12 },
    sharp:  { maxTiles: 7, pick: 0, cap: 0 }
  };

  function WordAI(level, trie) {
    this.level = LEVELS[level] ? level : 'steady';
    this.cfg = LEVELS[this.level];
    this.trie = trie || null;
  }

  WordAI.prototype.setDictionary = function (trie) { this.trie = trie; };

  /* ---------- the board, as the search wants it ---------- */
  function boardLetters(g) {
    const grid = [];
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) {
        const t = g.at(r, c);
        row.push(t ? t.ch.toLowerCase() : null);
      }
      grid.push(row);
    }
    return grid;
  }

  /* Empty squares that touch a letter. On an empty board there is one
     place to start and it is the middle. */
  function anchors(grid) {
    const out = [];
    let any = false;
    for (let r = 0; r < SIZE && !any; r++) for (let c = 0; c < SIZE; c++) if (grid[r][c]) { any = true; break; }
    if (!any) return [{ r: MID, c: MID }];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c]) continue;
        if ((r > 0 && grid[r - 1][c]) || (r < SIZE - 1 && grid[r + 1][c]) ||
            (c > 0 && grid[r][c - 1]) || (c < SIZE - 1 && grid[r][c + 1])) {
          out.push({ r: r, c: c });
        }
      }
    }
    return out;
  }

  /* For every empty square, which letters make a word in the direction
     ACROSS the one being played. A mask of 26 bits; ALL means the square
     has no perpendicular neighbours and so constrains nothing. */
  WordAI.prototype.crossChecks = function (grid, down) {
    const trie = this.trie;
    const mask = [];
    for (let r = 0; r < SIZE; r++) {
      const row = new Int32Array(SIZE);
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c]) { row[c] = 0; continue; }

        /* The perpendicular direction: if the play runs down, the check
           runs across. */
        const dr = down ? 0 : 1, dc = down ? 1 : 0;
        let before = '', after = '';
        let rr = r - dr, cc = c - dc;
        while (rr >= 0 && cc >= 0 && grid[rr][cc]) { before = grid[rr][cc] + before; rr -= dr; cc -= dc; }
        rr = r + dr; cc = c + dc;
        while (rr < SIZE && cc < SIZE && grid[rr][cc]) { after += grid[rr][cc]; rr += dr; cc += dc; }

        if (!before && !after) { row[c] = ALL; continue; }

        let m = 0;
        for (let i = 0; i < 26; i++) {
          if (trie.has(before + String.fromCharCode(A + i) + after)) m |= (1 << i);
        }
        row[c] = m;
      }
      mask.push(row);
    }
    return mask;
  };

  /* ---------- scoring a candidate ----------
     Done from the same premium table the rules use, so the computer
     cannot be scoring by different arithmetic from the player. */
  function scoreMove(grid, placements, down, values) {
    let total = 0;
    const fresh = {};
    for (const p of placements) fresh[p.r + ',' + p.c] = p;

    const value = function (r, c) {
      const f = fresh[r + ',' + c];
      if (f) return f.blank ? 0 : (values[f.ch] || 0);
      const ch = grid[r][c];
      return ch ? (values[ch.toUpperCase()] || 0) : 0;
    };

    const runScore = function (cells) {
      let sum = 0, mult = 1;
      for (const cell of cells) {
        let v = value(cell.r, cell.c);
        if (fresh[cell.r + ',' + cell.c]) {
          const prem = W.premiumAt(cell.r, cell.c);
          if (prem === 'd') v *= 2;
          else if (prem === 't') v *= 3;
          else if (prem === 'D' || prem === 'C') mult *= 2;
          else if (prem === 'T') mult *= 3;
        }
        sum += v;
      }
      return sum * mult;
    };

    const occupied = function (r, c) {
      return (r >= 0 && c >= 0 && r < SIZE && c < SIZE) &&
        (!!grid[r][c] || !!fresh[r + ',' + c]);
    };
    const gather = function (r, c, dr, dc) {
      let rr = r, cc = c;
      while (occupied(rr - dr, cc - dc)) { rr -= dr; cc -= dc; }
      const cells = [];
      while (occupied(rr, cc)) { cells.push({ r: rr, c: cc }); rr += dr; cc += dc; }
      return cells;
    };

    /* the main word */
    const first = placements[0];
    const main = gather(first.r, first.c, down ? 1 : 0, down ? 0 : 1);
    if (main.length > 1) total += runScore(main);

    /* and every word the new tiles make the other way */
    for (const p of placements) {
      const cross = gather(p.r, p.c, down ? 0 : 1, down ? 1 : 0);
      if (cross.length > 1) total += runScore(cross);
    }

    if (placements.length === RACK) total += (W.BINGO || 50);
    return total;
  }

  /* ---------- the search ----------
     Walk out from an anchor, left part first and then right, stepping
     through the trie as letters are committed. Every complete word that
     uses at least one tile from the rack and sits legally on the board
     becomes a candidate. */
  WordAI.prototype.findMoves = function (g, p, limit) {
    const trie = this.trie;
    if (!trie) return [];
    const grid = boardLetters(g);
    const rack = g.racks[p].slice();
    const values = {};
    for (const ch of Object.keys(W.LETTERS || {})) values[ch] = W.LETTERS[ch].v;

    const empty = anchors(grid);
    const found = [];
    const seen = new Set();
    const maxTiles = Math.min(this.cfg.maxTiles, rack.length);
    const deadline = Date.now() + (limit || 2500);

    for (const down of [false, true]) {
      const cross = this.crossChecks(grid, down);
      const dr = down ? 1 : 0, dc = down ? 0 : 1;

      for (const anchor of empty) {
        if (Date.now() > deadline) break;

        /* How far back the word may begin: either over letters already
           down, or across empty squares that are not themselves anchors
           (otherwise the same word is found from both ends). */
        let back = 0;
        let rr = anchor.r - dr, cc = anchor.c - dc;
        while (rr >= 0 && cc >= 0 && !grid[rr][cc] && back < maxTiles - 1) {
          if (empty.some(a => a.r === rr && a.c === cc)) break;
          back++; rr -= dr; cc -= dc;
        }

        for (let skip = 0; skip <= back; skip++) {
          const startR = anchor.r - dr * skip, startC = anchor.c - dc * skip;
          /* If there are letters immediately before the start, the word
             really begins further back and will be found from there. */
          const pr = startR - dr, pc = startC - dc;
          if (pr >= 0 && pc >= 0 && grid[pr][pc]) continue;
          this.extend(grid, cross, rack, startR, startC, dr, dc, 0, [], found, seen,
            values, down, maxTiles, deadline, g);
        }
      }
    }

    found.sort((a, b) => b.score - a.score);
    return found;
  };

  /* One step along the line: either the letter already there, or a tile
     off the rack that the cross-check allows. */
  WordAI.prototype.extend = function (grid, cross, rack, r, c, dr, dc, node,
                                      used, out, seen, values, down, maxTiles, deadline, g) {
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return;
    if (Date.now() > deadline) return;
    const trie = this.trie;

    const here = grid[r][c];
    if (here) {
      const n2 = trie.step(node, idx(here));
      if (n2 < 0) return;
      this.record(grid, n2, used, out, seen, values, down, r + dr, c + dc, g);
      this.extend(grid, cross, rack, r + dr, c + dc, dr, dc, n2, used, out, seen,
        values, down, maxTiles, deadline, g);
      return;
    }

    if (used.length >= maxTiles) return;
    const allowed = cross[r][c];
    const tried = new Set();

    for (let i = 0; i < rack.length; i++) {
      const tile = rack[i];
      if (!tile) continue;
      const isBlank = tile.ch === '?';
      const options = isBlank ? null : [idx(tile.ch)];

      for (let li = 0; li < 26; li++) {
        if (options && options.indexOf(li) < 0) continue;
        if (!(allowed & (1 << li))) continue;
        /* Two identical tiles would explore the same branch twice. */
        const sig = (isBlank ? 'b' : 'l') + li;
        if (tried.has(sig)) continue;

        const n2 = trie.step(node, li);
        if (n2 < 0) continue;
        tried.add(sig);

        rack[i] = null;
        used.push({ r: r, c: c, id: tile.id, ch: letter(li), blank: isBlank });
        this.record(grid, n2, used, out, seen, values, down, r + dr, c + dc, g);
        this.extend(grid, cross, rack, r + dr, c + dc, dr, dc, n2, used, out, seen,
          values, down, maxTiles, deadline, g);
        used.pop();
        rack[i] = tile;
      }
    }
  };

  /* A complete word, if the square after it is empty and at least one
     tile came off the rack. */
  WordAI.prototype.record = function (grid, node, used, out, seen, values, down, nr, nc, g) {
    if (!used.length) return;
    if (!this.trie.isWord(node)) return;
    if (nr >= 0 && nc >= 0 && nr < SIZE && nc < SIZE && grid[nr][nc]) return;   // the word runs on

    /* The first play has to cross the middle. Every later one has to
       touch a letter already down — and the anchor does NOT guarantee
       that, because a word can finish before it reaches the anchor it
       was started from. Checking the finished word is the only honest
       way, and skipping it produced moves the rules then refused. */
    const boardEmpty = Object.keys(g.board).length === 0;
    if (boardEmpty) {
      if (!used.some(u => u.r === MID && u.c === MID)) return;
      if (used.length < 2) return;
    } else {
      const joined = used.some(function (u) {
        return [[0, 1], [0, -1], [1, 0], [-1, 0]].some(function (d) {
          const rr = u.r + d[0], cc = u.c + d[1];
          return rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE && !!grid[rr][cc];
        });
      });
      if (!joined) return;
    }

    const key = used.map(u => u.r + ',' + u.c + u.ch).join('|');
    if (seen.has(key)) return;
    seen.add(key);

    out.push({
      tiles: used.map(u => ({ id: u.id, r: u.r, c: u.c, ch: u.ch, blank: u.blank })),
      score: scoreMove(grid, used, down, values),
      down: down
    });
  };

  /* ---------- choosing ---------- */
  WordAI.prototype.decide = function (g, p, budgetMs) {
    if (g.placed.length) g.takeBackAll(p);
    const moves = this.findMoves(g, p, budgetMs || 2500);

    if (moves.length) {
      const cfg = this.cfg;
      /* Sharp takes the best. The others look down the list — Easy a long
         way down — so they play real words that are not the best words. */
      let pool = moves;
      if (cfg.cap) pool = moves.slice(0, Math.max(1, Math.min(cfg.cap, moves.length)));
      let pick = 0;
      if (cfg.pick > 0 && pool.length > 1) {
        pick = Math.floor(Math.pow(Math.random(), 1 / cfg.pick) * pool.length);
        if (pick >= pool.length) pick = pool.length - 1;
      }
      return { kind: 'play', move: pool[pick], considered: moves.length };
    }

    if (g.bag.length) return { kind: 'swap', ids: this.worstTiles(g, p) };
    return { kind: 'pass' };
  };

  /* With nothing to play, throw back the tiles that are hardest to use.
     Vowel-starved and vowel-drowned racks are both dead, so this keeps an
     eye on the balance rather than just dumping the big letters. */
  WordAI.prototype.worstTiles = function (g, p) {
    const rack = g.racks[p];
    const vowels = rack.filter(t => 'AEIOU'.indexOf(t.ch) >= 0).length;
    const wantVowels = 3;
    const scored = rack.map(function (t) {
      let bad = 0;
      const isVowel = 'AEIOU'.indexOf(t.ch) >= 0;
      if (t.ch === '?') return { id: t.id, bad: -100 };          // never throw a blank
      if (isVowel && vowels > wantVowels) bad += 2;
      if (!isVowel && vowels < wantVowels) bad += 2;
      if ('QZXJVWK'.indexOf(t.ch) >= 0) bad += 2;
      return { id: t.id, bad: bad };
    });
    scored.sort((a, b) => b.bad - a.bad);
    const want = Math.min(g.bag.length, this.level === 'easy' ? 3 : 4);
    /* Always at least one: a swap of nothing is not a turn, and returning
       an empty list here once stopped a game dead. */
    const howMany = Math.max(1, Math.min(want, scored.length));
    return scored.slice(0, howMany).map(x => x.id);
  };

  /* Should the computer challenge what was just played? It knows the
     dictionary perfectly, so it would always be right — which is no fun
     and not much like a person. It challenges a word it does not know,
     and only sometimes. */
  WordAI.prototype.wantsChallenge = function (g, p) {
    if (!g.canChallenge(p) || !g.open) return false;
    const unknown = g.open.words.some(w => !this.trie.has(w));
    if (!unknown) return false;
    const chance = this.level === 'easy' ? 0.4 : this.level === 'steady' ? 0.7 : 0.95;
    return Math.random() < chance;
  };

  WordAI.LEVELS = LEVELS;
  return WordAI;
}));
