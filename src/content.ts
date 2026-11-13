import { memberName, parseFloors, parseTopic } from './parse';
import { buildTree } from './resolve';
import { loadForeignFloors } from './fetcher';
import { View } from './render';
import type { Floor } from './types';

(function main() {
  if ((window as unknown as { __vxfLoaded?: boolean }).__vxfLoaded) return;
  (window as unknown as { __vxfLoaded?: boolean }).__vxfLoaded = true;

  const m = /^\/t\/(\d+)/.exec(location.pathname);
  if (!m) return;
  const topicId = m[1];
  const firstBox = document.querySelector('div.cell[id^="r_"]')?.closest('div.box') as HTMLElement | null;
  if (!firstBox) return;
  const container = firstBox.parentElement;

  const findBox = (): HTMLElement | null =>
    (container?.querySelector('div.cell[id^="r_"]')?.closest('div.box') as HTMLElement | null) ?? null;

  const selfName = memberName(
    document.querySelector('#Top .tools a[href^="/member/"]')?.getAttribute('href') ?? null
  );

  const view = new View({
    box: firstBox,
    originalChildren: Array.from(firstBox.childNodes),
    selfName,
  });

  function readCurrentPage(): number {
    const p = parseInt(new URLSearchParams(location.search).get('p') ?? '', 10);
    if (Number.isFinite(p) && p > 0) return p;
    const input = document.querySelector<HTMLInputElement>('input.page_input');
    const v = parseInt(input?.value ?? '1', 10);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  let generation = 0;
  let abortCtrl: AbortController | null = null;

  async function rebuild() {
    const gen = ++generation;
    abortCtrl?.abort();
    abortCtrl = null;

    // 回复后站方可能换页、增页，每次都重新解析当前文档
    const current = readCurrentPage();
    const meta = parseTopic(document);
    const nativeFloors = parseFloors(document, current);

    // Phase 1：0ms 同步用当前页建树并显示，避免白屏等待
    view.setMergedAll(true);
    view.setStatus(meta.totalPages > 1 ? `合并其余 ${meta.totalPages - 1} 页中…` : '');
    view.setData(buildTree(nativeFloors));
    view.render();

    // Phase 1 已解除隐藏，立即撤掉兜底定时器
    window.clearTimeout((window as unknown as { __vxfFallback?: number }).__vxfFallback);

    // 初次进入且带 #r_xxx 锚点时，定位到目标楼层
    if (gen === 1 && /^#r_\d+$/.test(location.hash)) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
    }

    if (meta.totalPages <= 1) return;

    // Phase 2：后台抓取其余分页，完成后增量合并并保持阅读滚动位置
    const pages: number[] = [];
    for (let p = 1; p <= meta.totalPages; p++) if (p !== current) pages.push(p);

    const ctrl = new AbortController();
    abortCtrl = ctrl;
    const { floors: foreign, failed, aborted } = await loadForeignFloors(topicId, pages, {
      signal: ctrl.signal,
      onProgress: (done, total) => {
        if (gen === generation) view.setStatus(`合并中 ${done}/${total} 页…`);
      },
    });
    if (aborted || gen !== generation) return;

    for (const f of foreign) {
      f.el = document.importNode(f.el, true);
    }
    const allFloors: Floor[] = [...nativeFloors, ...foreign];
    view.setData(buildTree(allFloors));

    if (failed.length) {
      const sortedFailed = [...failed].sort((a, b) => a - b);
      view.setMergedAll(false);
      view.setStatus(`第 ${sortedFailed.join('、')} 页失败`, 'warn');
      view.toast(`第 ${sortedFailed.join('、')} 页加载失败，部分回复暂未合并`, 'warn');
    } else {
      view.setMergedAll(true);
      view.setStatus(`已合并 ${meta.totalPages} 页`);
    }

    if (view.getMode() === 'tree') {
      view.buildThread();
      // 若锚点楼层来自外页，合并完成后补一次定位（仅当用户尚未手动滚动）
      if (gen === 1 && window.scrollY === 0 && /^#r_\d+$/.test(location.hash)) {
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
      }
    }

    // 抓取期间站方若又替换了列表，补一次重建
    const latest = findBox();
    if (latest && !latest.classList.contains('vxf-threaded') && !latest.classList.contains('vxf-raw')) {
      view.retarget(latest);
      void rebuild();
    }
  }

  void rebuild();

  // V2EX 回复走 AJAX：成功后站方替换 #topic-replies 的子节点（整个 box 被换掉），
  // 页面不跳转、脚本不会重跑，所以监听外层容器，发现新 box 就重建对话树
  if (container) {
    new MutationObserver(() => {
      const next = findBox();
      if (!next || next.classList.contains('vxf-threaded') || next.classList.contains('vxf-raw')) return;
      view.retarget(next);
      void rebuild();
    }).observe(container, { childList: true });
  }
})();
