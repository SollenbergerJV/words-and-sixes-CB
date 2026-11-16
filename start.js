'use strict';
/* ============================================================
   The starting point, and a small piece of insurance.

   Uploading a folder to GitHub through a browser is easy to get
   half-right: the files can land one level deeper than intended,
   and the only symptom is a host reporting

       Cannot find module '.../server/index.js'

   which says nothing about what to do. So rather than insist on one
   layout, this finds the server wherever it actually is, says where
   it found it, and only gives up with an explanation a person can
   act on.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const TARGET = path.join('server', 'index.js');

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

function find() {
  // the layout we expect: server/ sitting beside this file
  const direct = path.join(HERE, TARGET);
  if (exists(direct)) return { file: direct, nested: false };

  /* One level down: the whole project inside a folder of its own,
     which is what a drag-and-drop upload produces if the folder is
     dragged instead of its contents. */
  let entries = [];
  try { entries = fs.readdirSync(HERE, { withFileTypes: true }); } catch (e) { entries = []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name.charAt(0) === '.') continue;
    const candidate = path.join(HERE, e.name, TARGET);
    if (exists(candidate)) return { file: candidate, nested: true, folder: e.name };
  }
  /* Everything in one pile. A browser file-picker upload flattens folders
     completely, which is a perfectly ordinary thing for a person to end up
     with, and refusing to run is a poor answer to it. The server detects
     the same layout for itself and serves from one folder. */
  const trio = ['index.js', 'ws.js', 'rooms.js'];
  if (trio.every(function (n) { return exists(path.join(HERE, n)); })) {
    return { file: path.join(HERE, 'index.js'), nested: false, flat: true };
  }

  return null;
}

const found = find();

if (!found) {
  const listing = (function () {
    try {
      return fs.readdirSync(HERE)
        .filter(function (n) { return n.charAt(0) !== '.'; })
        .sort().join(', ') || '(nothing)';
    } catch (e) { return '(could not be read)'; }
  })();

  console.error('');
  console.error('  Words & Sixes could not start: the "server" folder is missing.');
  console.error('');
  console.error('  Looked in: ' + HERE);
  console.error('  Found there: ' + listing);
  console.error('');
  console.error('  The top level of the repository needs to hold package.json,');
  console.error('  render.yaml, and the folders public, server, shared and test.');
  console.error('  If some of those are inside another folder, the upload went one');
  console.error('  level too deep — re-upload from INSIDE the unzipped folder.');
  console.error('');
  process.exit(1);
}

if (found.flat) {
  console.log('Every file is in one folder — that is fine, starting from there.');
}
if (found.nested) {
  console.warn('');
  console.warn('  Note: the app was found inside the "' + found.folder + '" folder rather than');
  console.warn('  at the top level. It will run perfectly well from there, but the');
  console.warn('  tidier arrangement is to have package.json and the public / server /');
  console.warn('  shared folders sitting together at the top of the repository.');
  console.warn('');
}

require(found.file);
