/**
 * Smoke test for the ZSTG app's build output.
 *
 * Run after `node import-audited-source.js` (or any change to index.html /
 * sw.js / manifest.json) to catch broken data, missing assets, and JS syntax
 * errors before they ship. No dependencies — plain Node.
 *
 * Usage: node smoke-test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP_DIR = __dirname;
const ASSETS_DIR = path.join(APP_DIR, 'assets');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// --- Data integrity -------------------------------------------------------

section('assets/data.json');

const dataPath = path.join(ASSETS_DIR, 'data.json');
let DATA;
check('parses as JSON', () => {
  DATA = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
});

if (DATA) {
  check('meta.total_conditions matches conditions.length', () => {
    assert.strictEqual(DATA.meta.total_conditions, DATA.conditions.length);
  });

  check('meta.total_drugs matches drugs.length', () => {
    assert.strictEqual(DATA.meta.total_drugs, DATA.drugs.length);
  });

  check('meta.unique_drugs matches drug_index.length', () => {
    assert.strictEqual(DATA.meta.unique_drugs, DATA.drug_index.length);
  });

  check('expects 6 sections (1.0 through 6.0)', () => {
    const codes = Object.values(DATA.sections).map(s => s.code).sort();
    assert.deepStrictEqual(codes, ['1.0', '2.0', '3.0', '4.0', '5.0', '6.0']);
  });

  check('every section has name, color, icon, order', () => {
    for (const [key, s] of Object.entries(DATA.sections)) {
      assert.ok(s.name, `${key} missing name`);
      assert.ok(/^#[0-9A-Fa-f]{6}$/.test(s.color), `${key} has invalid color ${s.color}`);
      assert.ok(s.icon, `${key} missing icon`);
      assert.ok(Number.isInteger(s.order), `${key} missing order`);
    }
  });

  check('no duplicate condition ids', () => {
    const ids = DATA.conditions.map(c => c.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.strictEqual(dupes.length, 0, `duplicates: ${[...new Set(dupes)].join(', ')}`);
  });

  check('every condition has a title, section, and non-empty source_content', () => {
    for (const c of DATA.conditions) {
      assert.ok(c.title, `${c.id} missing title`);
      assert.ok(DATA.sections[c.section], `${c.id} references unknown section ${c.section}`);
      assert.ok(Array.isArray(c.data.source_content) && c.data.source_content.length > 0,
        `${c.id} has empty source_content`);
    }
  });

  check('every condition\'s subsection exists in subsections map', () => {
    for (const c of DATA.conditions) {
      assert.ok(DATA.subsections[c.subsection], `${c.id} references unknown subsection ${c.subsection}`);
    }
  });

  check('every section has at least one condition', () => {
    const bySection = new Set(DATA.conditions.map(c => c.section));
    for (const key of Object.keys(DATA.sections)) {
      assert.ok(bySection.has(key), `section ${key} has zero conditions`);
    }
  });

  check('drug_index entries all have at least one mention in drugs', () => {
    const mentionNames = new Set(DATA.drugs.map(d => d.name));
    for (const entry of DATA.drug_index) {
      assert.ok(mentionNames.has(entry.name), `${entry.name} in drug_index but not in drugs`);
    }
  });

  check('emergency_ids all reference real conditions in emergencies_and_poisons', () => {
    const ids = new Set(DATA.conditions.map(c => c.id));
    for (const id of DATA.emergency_ids) {
      assert.ok(ids.has(id), `emergency_ids references unknown condition ${id}`);
    }
  });
}

// --- Embedded data matches data.json ---------------------------------------

section('assets/data-embed.js');

check('defines EMBEDDED_ZSTG_DATA and matches data.json byte-for-byte', () => {
  const embedSrc = fs.readFileSync(path.join(ASSETS_DIR, 'data-embed.js'), 'utf8');
  assert.ok(embedSrc.startsWith('const EMBEDDED_ZSTG_DATA = '), 'unexpected file format');
  const embedded = JSON.parse(embedSrc.slice('const EMBEDDED_ZSTG_DATA = '.length, -2));
  assert.deepStrictEqual(embedded, DATA, 'data-embed.js is out of sync with data.json — rerun import-audited-source.js');
});

// --- manifest.json ----------------------------------------------------------

section('manifest.json');

check('parses as JSON and every icon file exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'no icons declared');
  for (const icon of manifest.icons) {
    const iconPath = path.join(APP_DIR, icon.src);
    assert.ok(fs.existsSync(iconPath), `manifest references missing icon ${icon.src}`);
  }
});

// --- sw.js --------------------------------------------------------------

section('sw.js');

const swSrc = fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8');

check('has valid JS syntax', () => {
  new Function(swSrc); // eslint-disable-line no-new-func
});

check('every PRECACHE_URLS entry exists on disk', () => {
  const match = swSrc.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(match, 'could not find PRECACHE_URLS in sw.js');
  const urls = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(urls.length > 0, 'PRECACHE_URLS is empty');
  for (const url of urls) {
    if (url === './') continue;
    const filePath = path.join(APP_DIR, url);
    assert.ok(fs.existsSync(filePath), `precached URL ${url} does not exist on disk`);
  }
});

// --- index.html -----------------------------------------------------------

section('index.html');

const htmlSrc = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');

check('every inline <script> block has valid JS syntax', () => {
  const scripts = [...htmlSrc.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, 'no inline scripts found');
  for (const [, body] of scripts) {
    if (!body.trim()) continue;
    new Function(body); // eslint-disable-line no-new-func
  }
});

check('escapeHtml() is defined and used to sanitize user search input', () => {
  assert.ok(/function escapeHtml\(/.test(htmlSrc), 'escapeHtml() helper is missing');
  assert.ok(/escapeHtml\(query\)/.test(htmlSrc), 'search "no results" message is not escaped');
});

check('service worker cache name is registered', () => {
  assert.ok(/navigator\.serviceWorker\.register/.test(htmlSrc), 'app does not register a service worker');
});

// --- summary ----------------------------------------------------------

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('All checks passed.');
}
