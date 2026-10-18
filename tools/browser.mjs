// Headless jobs for the Slide Builder (run by `sb` and the server). Always loads the plain
// deck (?raw=1), so the Slide Builder shell never ends up in a screenshot or a PDF.
//
//   node browser.mjs titles <slug> [--version v]
//   node browser.mjs edits  <slug> [--version v]   (the reviewer's inline edits and order, read-only)
//   node browser.mjs shot   <slug> <outdir> [--version v] <slide-id> ...
//   node browser.mjs audit  <slug> [--version v]
//   node browser.mjs export <slug> <out.pdf> [--version v]
//   node browser.mjs thumb  <slug> <out.png>
//   node browser.mjs chrome                        (print the Chrome it will use; setup.sh asks)
//
// The server is at SB_URL (sb and the server set it), else http://localhost:$SB_PORT (8790).
// Chrome: SB_CHROME if set, else Playwright's Chrome for Testing (setup.sh installs it),
// else an installed Google Chrome or Chromium.
import { chromium } from 'playwright-core';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BASE = (process.env.SB_URL || `http://localhost:${process.env.SB_PORT || 8790}`).replace(/\/$/, '');
const args = process.argv.slice(2);
const cmd = args.shift();
const vi = args.indexOf('--version'); let version = null;
if (vi >= 0) { version = args[vi + 1]; args.splice(vi, 2); }

function chrome() {
  const env = process.env.SB_CHROME;
  if (env) { if (fs.existsSync(env)) return env; throw new Error(`SB_CHROME is set to ${env}, which does not exist`); }
  // where Playwright keeps its browsers, newest first
  const home = os.homedir();
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(home, 'Library/Caches/ms-playwright'), path.join(home, '.cache/ms-playwright'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')].filter((r) => r && r !== '0' && fs.existsSync(r));
  const inside = ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe'];
  for (const root of roots) {
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
    for (const d of dirs) for (const rel of inside) { const exe = path.join(root, d, rel); if (fs.existsSync(exe)) return exe; }
  }
  try { const exe = chromium.executablePath(); if (exe && fs.existsSync(exe)) return exe; } catch (e) { /* not installed */ }
  const system = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const exe of system) if (fs.existsSync(exe)) return exe;
  throw new Error('No Chrome found. Run ./setup.sh (it installs Chrome for Testing), or set SB_CHROME to a Chrome or Chromium executable.');
}

async function open(slug, width = 1600, withState = false) {
  const deck = await (await fetch(`${BASE}/api/decks/${slug}`)).json();
  if (deck.error) throw new Error(`no deck ${slug}`);
  const browser = await chromium.launch({ executablePath: chrome(), headless: true });
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}${deck.url}?${withState ? 'readonly=1' : 'raw=1'}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (version) {
    const ok = await page.evaluate((v) => { const s = document.querySelector('.sidebar select'); if (!s || ![...s.options].some((o) => o.value === v)) return false; s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); return true; }, version);
    if (!ok) throw new Error(`no version ${version}`);
  }
  await page.waitForTimeout(900);
  return { browser, page, deck, errors };
}

const order = (page) => page.evaluate(() => [...document.getElementById('deck').children].filter((n) => n.dataset && n.dataset.id).map((w, i) => {
  const id = w.dataset.id; let t = '';
  try { t = typeof titleOf === 'function' ? titleOf(id) : ''; } catch (e) {}           // eslint-disable-line no-undef
  if (!t) { try { const b = LIBRARY[id] || {}; t = String(b.title || b.q || id).replace(/<[^>]+>/g, ''); } catch (e) { t = id; } } // eslint-disable-line no-undef
  return { n: i + 1, id, title: t };
}));

async function main() {
  if (cmd === 'chrome') { console.log(chrome()); return; }
  const slug = args.shift();
  if (cmd === 'titles') {
    const { browser, page } = await open(slug);
    console.log(JSON.stringify(await order(page)));
    await browser.close(); return;
  }
  if (cmd === 'edits') {   // the reviewer's inline edits and reordering, from the state saved on disk
    const { browser, page } = await open(slug, 1600, true);
    const res = await page.evaluate(() => {
      const deckEl = document.getElementById('deck'), wraps = [...deckEl.children].filter((n) => n.dataset && n.dataset.id);
      const edits = [];
      wraps.forEach((w, k) => {
        const id = w.dataset.id, now = [...w.querySelectorAll('[contenteditable]')].map((n) => n.innerHTML);
        let f = null; try { f = build(id); } catch (e) {}                                   // eslint-disable-line no-undef
        const def = f ? [...f.querySelectorAll('[contenteditable]')].map((n) => n.innerHTML) : [];
        for (let i = 0; i < Math.max(now.length, def.length); i++) if ((now[i] || '') !== (def[i] || '')) edits.push({ n: k + 1, id, field: i, was: def[i], now: now[i] });
      });
      let defaults = []; try { defaults = PITCHES[current].blocks; } catch (e) {}           // eslint-disable-line no-undef
      const order = wraps.map((w) => w.dataset.id);
      let version = ''; try { version = current; } catch (e) {}                              // eslint-disable-line no-undef
      return { version, edits, removed: defaults.filter((id) => !order.includes(id)), added: order.filter((id) => !defaults.includes(id)),
        reordered: JSON.stringify(order.filter((id) => defaults.includes(id))) !== JSON.stringify(defaults.filter((id) => order.includes(id))) };
    });
    console.log(JSON.stringify(res, null, 1));
    await browser.close(); return;
  }
  if (cmd === 'shot') {
    const outdir = args.shift(); fs.mkdirSync(outdir, { recursive: true });
    const { browser, page, errors } = await open(slug);
    for (const id of args) {
      let el = await page.$(`#deck > [data-id="${id}"] .slide`);
      if (!el) {   // a slide outside this version: build it at the end of the deck
        await page.evaluate((id) => { try { const w = build(id); if (w) { document.getElementById('deck').appendChild(w); if (typeof fitSlides === 'function') fitSlides(); } } catch (e) {} }, id); // eslint-disable-line no-undef
        await page.waitForTimeout(300); el = await page.$(`#deck > [data-id="${id}"] .slide`);
      }
      if (!el) { console.log('missing', id); continue; }
      await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(120);
      const file = path.join(outdir, `${id}.png`); await el.screenshot({ path: file }); console.log(file);
    }
    errors.forEach((e) => console.log('PAGE ERROR', e));
    await browser.close(); return;
  }
  if (cmd === 'audit') {
    const { browser, page, errors } = await open(slug);
    const res = await page.evaluate(() => {
      const out = [], wraps = [...document.getElementById('deck').children].filter((n) => n.dataset && n.dataset.id);
      const hit = (a, b) => { const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); return x * y; };
      wraps.forEach((w, k) => {
        const id = w.dataset.id, sl = w.querySelector('.slide'); if (!sl) return; const R = sl.getBoundingClientRect(), tag = `${k + 1} ${id}`;
        sl.querySelectorAll('*').forEach((n) => {
          if (n.closest('.ctrls, .slide-tag') || (n.closest('svg') && n.tagName.toLowerCase() !== 'svg')) return;
          const r = n.getBoundingClientRect(); if (!r.width || !r.height) return;
          const over = Math.max(R.left - r.left, r.right - R.right, R.top - r.top, r.bottom - R.bottom);
          if (over > 2) out.push(`${tag}: <${n.tagName.toLowerCase()}> runs ${Math.round(over)}px past the slide edge`);
          const cs = getComputedStyle(n);
          if (cs.overflow !== 'visible' && n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 3) out.push(`${tag}: <${n.tagName.toLowerCase()}> cuts off its text`);
        });
        sl.querySelectorAll('svg').forEach((svg) => {
          const S = svg.getBoundingClientRect();
          const texts = [...svg.querySelectorAll('text')].map((t) => ({ t, r: t.getBoundingClientRect() })).filter((x) => x.r.width && x.r.height && x.t.textContent.trim());
          texts.forEach(({ t, r }) => { const over = Math.max(S.left - r.left, r.right - S.right, S.top - r.top, r.bottom - S.bottom); if (over > 3) out.push(`${tag}: label “${t.textContent.trim().slice(0, 40)}” runs ${Math.round(over)}px outside its figure`); });
          for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i].r, b = texts[j].r, area = hit(a, b), small = Math.min(a.width * a.height, b.width * b.height);
            if (small && area / small > 0.18) out.push(`${tag}: labels overlap: “${texts[i].t.textContent.trim().slice(0, 30)}” and “${texts[j].t.textContent.trim().slice(0, 30)}”`);
          }
        });
      });
      return { n: wraps.length, out };
    });
    // the guides: two-line titles and the protected border (static/guides.js, the same check the page draws)
    await page.addScriptTag({ path: path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'static', 'guides.js') });
    const guides = await page.evaluate(() => [...document.getElementById('deck').children].filter((n) => n.dataset && n.dataset.id).flatMap((w, k) => {
      const sl = w.querySelector('.slide'); return sl ? window.SBGuides.issues(sl).map((g) => `${k + 1} ${w.dataset.id}: ${g.msg}`) : [];
    }));
    console.log(`slides: ${res.n}`); res.out.forEach((l) => console.log(l)); guides.forEach((l) => console.log(l)); errors.forEach((e) => console.log('PAGE ERROR', e));
    if (!res.out.length && !guides.length) console.log('No overflow, overlapping labels, long titles, or anything in the protected border.');
    await browser.close(); return;
  }
  if (cmd === 'export') {
    const out = args.shift();
    const { browser, page, errors } = await open(slug);
    await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(600);
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
    errors.forEach((e) => console.log('PAGE ERROR', e));
    console.log(out); await browser.close(); return;
  }
  if (cmd === 'thumb') {
    const out = args.shift();
    const { browser, page } = await open(slug);
    const el = await page.$('#deck > [data-id] .slide');
    if (el) await el.screenshot({ path: out });
    console.log(out); await browser.close(); return;
  }
  console.log('usage: node browser.mjs titles|edits|shot|audit|export|thumb <slug> ...  |  node browser.mjs chrome');
  process.exitCode = 2;
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
