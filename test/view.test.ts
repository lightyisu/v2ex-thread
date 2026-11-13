import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseFloors } from '../src/parse.ts';
import { buildTree } from '../src/resolve.ts';
import { View } from '../src/render.ts';

function setupFixtureDom() {
  const html = readFileSync(new URL('./fixtures/p1.html', import.meta.url), 'utf-8');
  const parsed = parseHTML(html);
  const doc = parsed.document;
  Object.assign(globalThis, {
    document: doc,
    Node: { TEXT_NODE: 3 },
    window: {
      scrollY: 0,
      innerHeight: 800,
      scrollBy: () => {},
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
  });
  return doc;
}

test('View preserves native header, supports Phase 1 -> Phase 2 merge and tree/raw toggle', () => {
  const doc = setupFixtureDom();
  const box = doc.querySelector('div.cell[id^="r_"]')?.closest('div.box') as HTMLElement;
  assert.ok(box);

  const originalChildren = Array.from(box.childNodes);
  const view = new View({ box, originalChildren, selfName: '6581' });

  // Phase 1: current page only
  const p1Floors = parseFloors(doc, 1);
  view.setMergedAll(true);
  view.setStatus('合并其余 3 页中…');
  view.setData(buildTree(p1Floors));
  view.buildThread();

  assert.ok(box.classList.contains('vxf-threaded'));
  assert.ok(box.classList.contains('vxf-merged'));
  const header = box.querySelector('.vxf-header');
  assert.ok(header, 'native header kept inside box');
  assert.ok(header!.textContent?.includes('314 replies'));
  assert.ok(header!.querySelector('.vxf-header-ctrl'));
  assert.equal(header!.querySelector('.vxf-status')?.textContent, '合并其余 3 页中…');

  // Phase 2: merge p2 into p1
  const p2Doc = parseHTML(readFileSync(new URL('./fixtures/p2.html', import.meta.url), 'utf-8')).document;
  const p2Floors = parseFloors(p2Doc, 2);
  for (const f of p2Floors) f.el = doc.importNode(f.el, true);
  const merged = [...p1Floors, ...p2Floors];
  view.setData(buildTree(merged));
  view.setStatus('已合并 2 页');
  view.buildThread();

  assert.equal(header!.querySelectorAll('.vxf-header-ctrl').length, 1, 'header ctrl not duplicated');
  // Check no duplicate .vxf-badge on self cells
  const firstSelfCell = box.querySelector('.vxf-cell:has(.vxf-self)');
  if (firstSelfCell) {
    assert.equal(firstSelfCell.querySelectorAll('.vxf-self').length, 1);
  }
  assert.equal(box.querySelectorAll('.vxf-node').length, 200);

  // Toggle to raw mode
  view.setMode('raw');
  assert.ok(box.classList.contains('vxf-raw'));
  assert.ok(!box.classList.contains('vxf-threaded'));
  assert.ok(!box.classList.contains('vxf-merged'));
  assert.equal(box.querySelectorAll('div.cell[id^="r_"]').length, 100, 'raw mode restores page 1 cells');
  assert.equal(box.querySelectorAll('.vxf-badge').length, 0, 'augmentations cleaned in raw mode');
  assert.ok(box.querySelector('.vxf-header-ctrl'), 'toggle control stays accessible in raw mode');

  // Toggle back to tree mode
  view.setMode('tree');
  assert.ok(box.classList.contains('vxf-threaded'));
  assert.equal(box.querySelectorAll('.vxf-node').length, 200);
});
