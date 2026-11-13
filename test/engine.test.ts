import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseFloors, parseLeadingMentions, parseTopic } from '../src/parse.ts';
import { buildTree, nearestAbove } from '../src/resolve.ts';
import type { Floor } from '../src/types.ts';

const fixture = (p: number) =>
  parseHTML(readFileSync(new URL(`./fixtures/p${p}.html`, import.meta.url), 'utf-8')).document;

function allFloors(): Floor[] {
  return [1, 2, 3, 4].flatMap((p) => parseFloors(fixture(p), p));
}

test('parseTopic reads meta from real page', () => {
  const meta = parseTopic(fixture(2));
  assert.equal(meta.title, '马上结婚了，但是吵架了！');
  assert.equal(meta.author, '6581');
  assert.equal(meta.totalPages, 4);
  assert.equal(meta.replyCount, 314);
});

test('parseFloors extracts every reply with floor numbers', () => {
  const floors = allFloors();
  assert.equal(floors.length, 314);
  const nos = floors.map((f) => f.no).sort((a, b) => a - b);
  assert.equal(nos[0], 1);
  assert.equal(nos[313], 314);
  assert.equal(new Set(nos).size, 314);
  const p2 = parseFloors(fixture(2), 2);
  assert.equal(p2.length, 100);
  assert.equal(p2[0].no, 101);
  assert.equal(p2[0].author, 'woodfizky');
  assert.equal(p2[0].replyId, '18278376');
  assert.ok(p2[0].time?.includes('2026-11-11'));
});

test('leading @mentions parsed with optional #floor', () => {
  const p2 = parseFloors(fixture(2), 2);
  const withMentions = p2.filter((f) => f.mentions.length > 0);
  assert.equal(withMentions.length, 30);
  const withRef = p2.filter((f) => f.mentions.some((m) => m.floorRef != null));
  assert.ok(withRef.length >= 10);
  const multi = p2.filter((f) => f.mentions.length > 1);
  assert.ok(multi.length >= 2);
});

test('parseLeadingMentions handles br separators and stops at body text', () => {
  const { document } = parseHTML(
    '<div class="reply_content">@<a href="/member/a">a</a> #12<br />@<a href="/member/b">b</a><br />正文 @<a href="/member/c">c</a></div>'
  );
  const ms = parseLeadingMentions(document.querySelector('.reply_content'));
  assert.deepEqual(ms, [
    { name: 'a', floorRef: 12 },
    { name: 'b', floorRef: null },
  ]);
});

test('tree merges replies into cited floors across pages', () => {
  const tree = buildTree(allFloors());
  assert.equal(tree.stats.total, 314);
  assert.equal(tree.stats.roots + tree.stats.merged, 314);
  assert.ok(tree.stats.merged > 50);
  assert.ok(tree.stats.exact >= 10);

  const crossPage = tree.roots.length
    ? [...tree.byNo.values()].find((f) => f.page === 2 && f.targetNo === 85)
    : null;
  assert.ok(crossPage, 'a page-2 reply should merge into floor 85 on page 1');
  assert.equal(tree.byNo.get(85)!.page, 1);
  assert.equal(crossPage!.confidence, 'exact');

  const exact101 = [...tree.byNo.values()].find(
    (f) => f.targetNo === 101 && f.confidence === 'exact'
  );
  assert.ok(exact101, 'explicit @woodfizky #101 should merge into 101');
});

test('tree invariants: acyclic, ordered, complete', () => {
  const tree = buildTree(allFloors());
  const visited = new Set<number>();
  const walk = (f: Floor, parentNo: number | null) => {
    assert.ok(!visited.has(f.no), `floor ${f.no} appears twice`);
    visited.add(f.no);
    if (parentNo != null) assert.ok(parentNo < f.no, `forward edge ${parentNo}->${f.no}`);
    let prev = 0;
    for (const c of f.children) {
      assert.ok(c.no > prev, 'children sorted by floor');
      prev = c.no;
      assert.equal(c.targetNo, f.no);
      walk(c, f.no);
    }
  };
  for (const r of tree.roots) {
    assert.equal(r.targetNo, null);
    walk(r, null);
  }
  assert.equal(visited.size, 314);
  for (const f of tree.byNo.values()) {
    if (f.targetNo != null && f.confidence === 'guess') {
      assert.equal(tree.byNo.get(f.targetNo)!.author, f.mentions[0].name);
    }
  }
});

test('nearestAbove picks the closest earlier floor of the author', () => {
  const tree = buildTree(allFloors());
  const f = nearestAbove(tree.byAuthor, 'woodfizky', 150);
  assert.ok(f);
  assert.ok(f!.no < 150);
  assert.equal(f!.author, 'woodfizky');
  const none = nearestAbove(tree.byAuthor, 'woodfizky', 1);
  assert.equal(none, null);
});

test('descendant counts are computed for every root', () => {
  const tree = buildTree(allFloors());
  const hot = [...tree.roots].sort(
    (a, b) => b.descendantCount - a.descendantCount || a.no - b.no
  );
  for (let i = 1; i < hot.length; i++) {
    assert.ok(hot[i - 1].descendantCount >= hot[i].descendantCount);
  }
  assert.equal(tree.roots[0].no, Math.min(...tree.roots.map((r) => r.no)));
});

const synthetic = (cells: string) =>
  parseHTML(`<div>${cells}</div>`).document;

const cell = (id: string, no: number, author: string, content: string) =>
  `<div id="r_${id}" class="cell"><table><tr><td><img class="avatar" data-uid="u${author}"></td><td>` +
  `<strong><a href="/member/${author}" class="dark">${author}</a></strong><div class="badges"></div>` +
  `<span class="ago" title="2026-11-11 10:00:00 +08:00">1h ago</span><span class="no">${no}</span>` +
  `<div class="reply_content">${content}</div></td></tr></table></div>`;

test('edge cases: forward ref, unresolved, deep chain, multi-@, self-reply', () => {
  const doc = synthetic(
    cell('1', 1, 'alice', '根楼') +
      cell('2', 2, 'bob', '@<a href="/member/alice">alice</a> #99 指向未来楼') +
      cell('3', 3, 'bob', '@<a href="/member/alice">alice</a> 就近回复') +
      cell('4', 4, 'carol', '@<a href="/member/nobody">nobody</a> 找不到原楼') +
      cell('5', 5, 'bob', '@<a href="/member/nobody">nobody</a> @<a href="/member/alice">alice</a> 第一个@无效，用第二个') +
      cell('6', 6, 'alice', '@<a href="/member/bob">bob</a> #3 精确回3楼') +
      cell('7', 7, 'bob', '@<a href="/member/alice">alice</a> #6 再回6楼') +
      cell('8', 8, 'alice', '@<a href="/member/alice">alice</a> #1 自己回自己')
  );
  const tree = buildTree(parseFloors(doc, 1));
  const byNo = tree.byNo;
  assert.equal(byNo.get(2)!.targetNo, 1, 'forward #99 falls back to nearest alice#1');
  assert.equal(byNo.get(2)!.confidence, 'guess');
  assert.equal(byNo.get(3)!.targetNo, 1);
  assert.equal(byNo.get(4)!.targetNo, null, 'unresolved stays root');
  assert.equal(byNo.get(5)!.targetNo, 1, 'second mention used when first unresolved');
  assert.equal(byNo.get(6)!.targetNo, 3);
  assert.equal(byNo.get(6)!.confidence, 'exact');
  assert.equal(byNo.get(7)!.targetNo, 6);
  assert.equal(byNo.get(7)!.depth, 3, 'chain 1->3->6->7');
  assert.equal(byNo.get(8)!.targetNo, 1, 'self-reply allowed');
  assert.equal(byNo.get(1)!.descendantCount, 6);
  assert.deepEqual(tree.roots.map((r) => r.no), [1, 4]);
});