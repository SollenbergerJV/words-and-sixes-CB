'use strict';
/* ============================================================
   WORD SQUARES — the dictionary, as the computer needs it.

   Checking whether a word exists only needs a set. Finding good words
   to play needs something that can answer "is anything at all spelled
   c-a-r-..." before the rest of the word is known, because that is the
   question that lets a search give up early instead of trying all seven
   tiles in every order in every square.

   So the words go into a trie. The obvious trie — twenty-six slots per
   node — measured 27 MB for this dictionary, which is no way to treat a
   phone. This one stores each node's children as a run in two shared
   arrays, which is the same structure at a tenth of the size. It is
   built from the dense form and the dense form is then dropped, so the
   cost is a moment of memory at startup rather than all session.
   ============================================================ */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WordTrie = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const A = 97;   // 'a'

  function WordTrie() {
    this.nodeStart = null;    // Int32Array(nodes + 1) — where a node's edges begin
    this.edgeLetter = null;   // Uint8Array(edges)     — 0..25
    this.edgeChild = null;    // Int32Array(edges)
    this.terminal = null;     // Uint8Array(nodes)
    this.nodes = 0;
    this.count = 0;
  }

  /* Build from a newline-separated list of lowercase words. */
  WordTrie.prototype.build = function (text) {
    const words = typeof text === 'string' ? text.split('\n') : text;

    /* First the plain twenty-six-wide trie, because it is simple and fast
       to fill. It is temporary. */
    let cap = 1 << 18;
    let dense = new Int32Array(cap * 26);
    let term = new Uint8Array(cap);
    let next = 1, count = 0;

    const grow = function () {
      const bigger = new Int32Array(cap * 2 * 26);
      bigger.set(dense);
      dense = bigger;
      const t2 = new Uint8Array(cap * 2);
      t2.set(term);
      term = t2;
      cap *= 2;
    };

    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      if (!w) continue;
      let n = 0, bad = false;
      for (let i = 0; i < w.length; i++) {
        const c = w.charCodeAt(i) - A;
        if (c < 0 || c > 25) { bad = true; break; }
        let k = dense[n * 26 + c];
        if (!k) {
          if (next >= cap) grow();
          k = next++;
          dense[n * 26 + c] = k;
        }
        n = k;
      }
      if (!bad && n > 0 && !term[n]) { term[n] = 1; count++; }
    }

    /* Now squeeze it: each node's children become a contiguous run. */
    const nodes = next;
    const nodeStart = new Int32Array(nodes + 1);
    let edges = 0;
    for (let n = 0; n < nodes; n++) {
      nodeStart[n] = edges;
      const base = n * 26;
      for (let c = 0; c < 26; c++) if (dense[base + c]) edges++;
    }
    nodeStart[nodes] = edges;

    const edgeLetter = new Uint8Array(edges);
    const edgeChild = new Int32Array(edges);
    let e = 0;
    for (let n = 0; n < nodes; n++) {
      const base = n * 26;
      for (let c = 0; c < 26; c++) {
        const k = dense[base + c];
        if (!k) continue;
        edgeLetter[e] = c;
        edgeChild[e] = k;
        e++;
      }
    }

    this.nodeStart = nodeStart;
    this.edgeLetter = edgeLetter;
    this.edgeChild = edgeChild;
    this.terminal = term.subarray(0, nodes);
    this.nodes = nodes;
    this.count = count;

    dense = null;    // the big one goes
    return this;
  };

  /* ---------- walking it ---------- */

  /* The node reached by following one letter, or -1. */
  WordTrie.prototype.step = function (node, letterIdx) {
    const from = this.nodeStart[node], to = this.nodeStart[node + 1];
    for (let e = from; e < to; e++) {
      if (this.edgeLetter[e] === letterIdx) return this.edgeChild[e];
    }
    return -1;
  };

  WordTrie.prototype.isWord = function (node) {
    return node > 0 && !!this.terminal[node];
  };

  /* Which letters may follow, as a 26-bit mask — the cheapest way to ask
     "what could possibly go here" in the inner loop of the search. */
  WordTrie.prototype.followMask = function (node) {
    let mask = 0;
    const from = this.nodeStart[node], to = this.nodeStart[node + 1];
    for (let e = from; e < to; e++) mask |= (1 << this.edgeLetter[e]);
    return mask;
  };

  WordTrie.prototype.nodeFor = function (word) {
    let n = 0;
    for (let i = 0; i < word.length; i++) {
      n = this.step(n, word.charCodeAt(i) - A);
      if (n < 0) return -1;
    }
    return n;
  };

  /* The same question the rules ask, answered from the same structure. */
  WordTrie.prototype.has = function (word) {
    const w = String(word).toLowerCase();
    const n = this.nodeFor(w);
    return n > 0 && !!this.terminal[n];
  };

  WordTrie.prototype.size = function () { return this.count; };

  /* Roughly how much memory this is using, for anyone who wants to know. */
  WordTrie.prototype.bytes = function () {
    return this.nodeStart.byteLength + this.edgeLetter.byteLength +
      this.edgeChild.byteLength + this.terminal.byteLength;
  };

  return WordTrie;
}));
