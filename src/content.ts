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

  function readCurrentPage(box: HTMLElement | null): number {
    const scope: ParentNode = box ?? document;
    const cur = scope.querySelector<HTMLElement>('a.page_current')?.textContent?.trim();
    const curNum = parseInt(cur ?? '', 10);
    if (Number.isFinite(curNum) && curNum > 0) return curNum;
    const input = scope.querySelector<HTMLInputElement>('input.page_input');
    const v = parseInt(input?.getAttribute('value') ?? input?.value ?? '', 10);
    if (Number.isFinite(v) && v > 0) return v;
    const p = parseInt(new URLSearchParams(location.search).get('p') ?? '', 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  }

  function resolveHashFloor(floors: Floor[], hash: string): Floor | null {
    const byId = /^#r_(\d+)$/.exec(hash);
    if (byId) return floors.find((f) => f.replyId === byId[1]) ?? null;
    const byNo = /^#reply(\d+)$/.exec(hash);
    if (byNo) {
      const no = parseInt(byNo[1], 10);
      return floors.find((f) => f.no === no) ?? null;
    }
    return null;
  }

  function pickNewReply(added: Floor[], hash: string): Floor | null {
    if (!added.length) return null;
    const byId = /^#r_(\d+)$/.exec(hash);
    if (byId) {
      const matched = added.find((f) => f.replyId === byId[1]);
      if (matched) return matched;
    }
    const mine = selfName ? added.filter((f) => f.author === selfName) : [];
    const pool = mine.length ? mine : added;
    return pool.reduce((best, f) => (f.no > best.no ? f : best));
  }

  function scrollToFloor(floor: Floor, opts: { behavior: ScrollBehavior; flash: boolean }) {
    if (view.getMode() === 'tree') {
      view.jumpTo(floor.no, opts);
    } else {
      document.getElementById('r_' + floor.replyId)?.scrollIntoView({ behavior: opts.behavior, block: 'center' });
    }
  }

  let generation = 0;
  let abortCtrl: AbortController | null = null;
  const knownReplyIds = new Set<string>();

  async function rebuild() {
    const gen = ++generation;
    const isReplyRefresh = gen > 1;
    abortCtrl?.abort();
    abortCtrl = null;

    // 回复后站方可能换页、增页，每次都重新解析当前文档
    const current = readCurrentPage(findBox());
    const meta = parseTopic(document);
    const nativeFloors = parseFloors(document, current);

    const addedNative = isReplyRefresh ? nativeFloors.filter((f) => !knownReplyIds.has(f.replyId)) : [];
    for (const f of nativeFloors) knownReplyIds.add(f.replyId);

    const phase1Target = isReplyRefresh
      ? pickNewReply(addedNative, location.hash)
      : resolveHashFloor(nativeFloors, location.hash);
    let targetReplyId: string | null = phase1Target?.replyId ?? null;

    // Phase 1：0ms 同步用当前页建树并显示，避免白屏等待
    view.setMergedAll(true);
    view.setStatus(meta.totalPages > 1 ? `合并其余 ${meta.totalPages - 1} 页中…` : '');
    view.setData(buildTree(nativeFloors));
    view.render();

    // Phase 1 已解除隐藏，立即撤掉兜底定时器
    window.clearTimeout((window as unknown as { __vxfFallback?: number }).__vxfFallback);

    // 定位到目标楼层：初次进入为 #r_xxx/#replyN 锚点，AJAX 回复后为刚发送的新回复
    if (phase1Target) {
      scrollToFloor(phase1Target, {
        behavior: isReplyRefresh && meta.totalPages <= 1 ? 'smooth' : 'auto',
        flash: isReplyRefresh && meta.totalPages <= 1,
      });
    }

    if (meta.totalPages <= 1) return;

    // Phase 2：后台抓取其余分页，完成后增量合并并保持阅读滚动位置
    const pages: number[] = [];
    for (let p = 1; p <= meta.totalPages; p++) if (p !== current) pages.push(p);

    let userScrolled = false;
    const markScrolled = (e: Event) => {
      if (
        e.type === 'keydown' &&
        !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes((e as KeyboardEvent).key)
      ) {
        return;
      }
      userScrolled = true;
    };
    window.addEventListener('wheel', markScrolled, { passive: true });
    window.addEventListener('touchmove', markScrolled, { passive: true });
    window.addEventListener('keydown', markScrolled, { passive: true });

    const ctrl = new AbortController();
    abortCtrl = ctrl;
    let loadResult: Awaited<ReturnType<typeof loadForeignFloors>>;
    try {
      loadResult = await loadForeignFloors(topicId, pages, {
        signal: ctrl.signal,
        onProgress: (done, total) => {
          if (gen === generation) view.setStatus(`合并中 ${done}/${total} 页…`);
        },
      });
    } finally {
      window.removeEventListener('wheel', markScrolled);
      window.removeEventListener('touchmove', markScrolled);
      window.removeEventListener('keydown', markScrolled);
    }
    const { floors: foreign, failed, aborted } = loadResult;
    if (aborted || gen !== generation) return;

    const addedForeign = isReplyRefresh ? foreign.filter((f) => !knownReplyIds.has(f.replyId)) : [];
    for (const f of foreign) {
      knownReplyIds.add(f.replyId);
      f.el = document.importNode(f.el, true);
    }
    const allFloors: Floor[] = [...nativeFloors, ...foreign];

    if (isReplyRefresh) {
      const foreignNew = pickNewReply(addedForeign, location.hash);
      if (foreignNew && (!phase1Target || foreignNew.no > phase1Target.no)) {
        targetReplyId = foreignNew.replyId;
      }
    }
    const finalTarget = targetReplyId
      ? allFloors.find((f) => f.replyId === targetReplyId) ?? null
      : isReplyRefresh
        ? null
        : resolveHashFloor(allFloors, location.hash);

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
      if (finalTarget && !userScrolled) {
        view.buildThread({ anchorNo: finalTarget.no });
        if (!view.isFloorCentered(finalTarget.no)) {
          view.jumpTo(finalTarget.no, {
            behavior: isReplyRefresh ? 'smooth' : 'auto',
            flash: isReplyRefresh,
          });
        } else if (isReplyRefresh) {
          view.flashFloor(finalTarget.no);
        }
      } else {
        view.buildThread();
      }
    } else if (finalTarget && !userScrolled && isReplyRefresh) {
      document.getElementById('r_' + finalTarget.replyId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
