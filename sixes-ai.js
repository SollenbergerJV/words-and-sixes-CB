'use strict';
/* ============================================================
   SIXES — the computer opponent.

   A turn is a sequence of placements, not one move, so the search is
   greedy and depth-first: find every legal single tile, take the best
   one, then look again from the position that leaves. That is close to
   how a person actually plays — you see a good tile, put it down, and
   then notice the line you have just opened.

   The three settings are not three algorithms. They are the same search
   with different appetites: Easy stops early and ignores the extras,
   Steady plays the best turn it finds, and Sharp also looks at what the
   turn leaves behind, because handing the other player a line of five
   is how a good turn turns bad.
   ============================================================ */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./sixes.js'));
  } else {
    root.SixesAI = factory({
      SixesGame: root.SixesGame, LINE_MAX: root.LINE_MAX || 6,
      SIX_BONUS: root.SIX_BONUS || 6, HAND_SIZE: root.HAND_SIZE || 6
    });
  }
}(typeof self !== 'undefined' ? self : this, function (S) {

  const LINE_MAX = S.LINE_MAX || 6;

  /* How the three settings actually differ.

     Not by cleverness: at this game a player who simply takes the most
     points available each turn is close to unbeatable, and every attempt
     to be cleverer than that — weighing up what the turn leaves behind,
     protecting the hand — measured WORSE over a few hundred games. So the
     ladder is built the honest way instead, out of thoroughness. Sharp
     looks at every tile in hand and plays the best turn it can find. The
     others stop looking sooner, and sometimes take the second-best move.
     That is how a person plays worse, too. */
  const LEVELS = {
    easy:   { cap: 2, stopChance: 0.5, slipChance: 0.35 },
    steady: { cap: 4, stopChance: 0.18, slipChance: 0.15 },
    sharp:  { cap: 6, stopChance: 0, slipChance: 0 }
  };

  function AI(level) {
    this.level = LEVELS[level] ? level : 'steady';   // 'easy' | 'steady' | 'sharp'
    this.cfg = LEVELS[this.level];
  }

  /* Every legal single placement in the position as it stands. */
  AI.prototype.moves = function (g, p) {
    const out = [];
    const squares = g.openSquares();
    const tried = new Set();
    for (const t of g.hands[p]) {
      /* Two identical tiles in hand would generate identical moves, and
         there is no sense searching the same branch twice. */
      const kind = t.c + t.s;
      for (const sq of squares) {
        const k = kind + '@' + sq.r + ',' + sq.c;
        if (tried.has(k)) continue;
        if (!g.canPlace(p, t.id, sq.r, sq.c).ok) continue;
        tried.add(k);
        out.push({ id: t.id, r: sq.r, c: sq.c });
      }
    }
    return out;
  };

  /* What a square would be worth if the other player got it next turn.
     Only the obvious case matters: a line of five with an open end is
     twelve points to whoever can finish it. */
  AI.prototype.gift = function (g) {
    let worst = 0;
    for (const sq of g.openSquares()) {
      for (const dir of [[0, 1], [1, 0]]) {
        const run = g.runThrough(sq.r, sq.c, dir[0], dir[1]);
        /* runThrough on an empty square returns the two halves joined,
           which is exactly the line that square would complete. */
        if (run.length === LINE_MAX - 1) worst = Math.max(worst, LINE_MAX + (S.SIX_BONUS || 6));
      }
    }
    return worst;
  };

  /* Build a whole turn, one tile at a time, keeping the best each step. */
  AI.prototype.planTurn = function (g, p) {
    const chosen = [];
    const cfg = this.cfg;

    for (;;) {
      if (chosen.length >= cfg.cap) break;
      const options = this.moves(g, p);
      if (!options.length) break;

      /* Score every legal placement, then keep the best two so that a
         weaker setting has something sensible to pick instead. */
      let best = null, bestScore = -Infinity, second = null, secondScore = -Infinity;
      for (const m of options) {
        const before = g.turnScore();
        g.place(p, m.id, m.r, m.c);
        const value = g.turnScore() - (chosen.length ? before : 0);
        g.unplace(p, m.id);
        /* A coin toss between equals keeps the computer from always
           building in the same direction, which looks mechanical. */
        if (value > bestScore || (value === bestScore && Math.random() < 0.3)) {
          second = best; secondScore = bestScore;
          bestScore = value; best = m;
        } else if (value > secondScore) {
          secondScore = value; second = m;
        }
      }
      if (!best) break;

      /* Stopping early and taking the second-best move are the two ways a
         person plays below their best, so they are the two the weaker
         settings use. Both still play a real, legal, sensible move. */
      if (chosen.length >= 1 && Math.random() < cfg.stopChance) break;
      const pick = (second && Math.random() < cfg.slipChance) ? second : best;

      g.place(p, pick.id, pick.r, pick.c);
      chosen.push(pick);
    }

    const score = chosen.length ? g.turnScore() : 0;
    for (let i = chosen.length - 1; i >= 0; i--) g.unplace(p, chosen[i].id);
    return { tiles: chosen, score: score };
  };

  /* The whole decision: play if there is anything, otherwise swap what
     looks least useful, otherwise nothing at all. */
  AI.prototype.decide = function (g, p) {
    if (g.placed.length) g.takeBackAll(p);
    const plan = this.planTurn(g, p);
    if (plan.tiles.length) return { kind: 'play', tiles: plan.tiles, score: plan.score };
    if (g.bag.length) return { kind: 'swap', ids: this.worstTiles(g, p) };
    return { kind: 'pass' };
  };

  /* Which tiles to throw back: the ones that share least with the rest of
     the hand, since a hand of six unrelated tiles can never make a line. */
  AI.prototype.worstTiles = function (g, p) {
    const hand = g.hands[p];
    const score = hand.map(function (t) {
      let friends = 0;
      for (const o of hand) {
        if (o === t) continue;
        if (o.c === t.c && o.s !== t.s) friends++;
        if (o.s === t.s && o.c !== t.c) friends++;
        if (o.c === t.c && o.s === t.s) friends--;     // a duplicate is dead weight
      }
      return { id: t.id, friends: friends };
    });
    score.sort((a, b) => a.friends - b.friends);
    const howMany = Math.min(
      g.bag.length,
      this.level === 'easy' ? 2 : Math.max(1, score.filter(x => x.friends <= 0).length) || 2
    );

    return score.slice(0, howMany).map(x => x.id);
  };

  return AI;
}));
