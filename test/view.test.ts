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

test('View.buildThread({ anchorNo }) locks target floor and skips unrelated fallback when absent', () => {
  const doc = setupFixtureDom();
  const scrolledBy: number[] = [];
  (globalThis as unknown as { window: { scrollY: number; scrollBy: (x: number, y: number) => void } }).window.scrollY = 1200;
  (globalThis as unknown as { window: { scrollBy: (x: number, y: number) => void } }).window.scrollBy = (
    _x: number,
    y: number
  ) => {
    scrolledBy.push(y);
  };

  const box = doc.querySelector('div.cell[id^="r_"]')?.closest('div.box') as HTMLElement;
  const p1Floors = parseFloors(doc, 1);
  const view = new View({ box, originalChildren: Array.from(box.childNodes), selfName: '6581' });

  const p4Doc = parseHTML(readFileSync(new URL('./fixtures/p4.html', import.meta.url), 'utf-8')).document;
  const p4Floors = parseFloors(p4Doc, 4).map((f) => ({ ...f, el: doc.importNode(f.el, true) }));
  view.setData(buildTree(p4Floors));
  view.buildThread();

  // Mock layout rects: node 301 at top=100, target node 314 at top=500 before merge
  const setNodeTop = (no: number, top: number) => {
    const node = box.querySelector<HTMLElement>(`.vxf-node[data-no="${no}"]`);
    if (node) {
      (node as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
        ({ top, bottom: top + 80, height: 80 } as DOMRect);
    }
  };
  setNodeTop(301, 100);
  setNodeTop(314, 500);

  view.setData(buildTree([...p1Floors, ...p4Floors]));

  // After rebuild, wrappers are recreated; patch getBoundingClientRect via appendChild spy or buildNode hook:
  // Even simpler: if anchorNo=9999 (foreign/absent), buildThread should NOT scrollBy to node 301!
  view.buildThread({ anchorNo: 9999 });
  assert.deepEqual(scrolledBy, [], 'absent anchorNo does not lock onto unrelated node 301');

  // When anchorNo=314 is visible before rebuild and shifts down by +18000 after merge, scrollBy follows 314
  const treeEl = box.querySelector('.vxf-tree') as HTMLElement;
  const origReplaceChildren = treeEl.replaceChildren.bind(treeEl);
  let patchAfterReplace = false;
  treeEl.replaceChildren = function (...nodes: (Node | string)[]) {
    origReplaceChildren(...nodes);
    if (patchAfterReplace) {
      setNodeTop(301, 18100);
      setNodeTop(314, 18500);
    }
  };
  setNodeTop(301, 100);
  setNodeTop(314, 500);
  patchAfterReplace = true;
  view.buildThread({ anchorNo: 314 });
  assert.deepEqual(scrolledBy, [18000]);
});

test('View.jumpTo scrolls to reply cell and isFloorCentered checks viewport bounds', () => {
  const doc = setupFixtureDom();
  const box = doc.querySelector('div.cell[id^="r_"]')?.closest('div.box') as HTMLElement;
  const view = new View({ box, originalChildren: Array.from(box.childNodes), selfName: '6581' });

  const p1Floors = parseFloors(doc, 1);
  view.setData(buildTree(p1Floors));
  view.buildThread();

  const targetCell = box.querySelector<HTMLElement>('.vxf-node[data-no="1"] > .vxf-cell')!;
  const calls: Array<ScrollIntoViewOptions | boolean | undefined> = [];
  (targetCell as unknown as { scrollIntoView: (opts?: ScrollIntoViewOptions) => void }).scrollIntoView = (opts) => {
    calls.push(opts);
  };
  (targetCell as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ top: 360, bottom: 440, height: 80 } as DOMRect);

  view.jumpTo(1, { behavior: 'auto', flash: false });
  assert.deepEqual(calls, [{ behavior: 'auto', block: 'center' }]);
  assert.ok(!targetCell.classList.contains('vxf-flash'));
  assert.equal(view.isFloorCentered(1), true);

  (targetCell as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ top: 700, bottom: 780, height: 80 } as DOMRect);
  assert.equal(view.isFloorCentered(1), false);

  view.jumpTo(1, { behavior: 'smooth', flash: true });
  assert.deepEqual(calls[1], { behavior: 'smooth', block: 'center' });
  assert.ok(targetCell.classList.contains('vxf-flash'));
});
