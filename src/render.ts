import type { Floor } from './types';
import type { ReplyTree } from './resolve';
import { nearestAbove } from './resolve.ts';
import { memberName } from './parse.ts';

export type ViewMode = 'tree' | 'raw';

export interface ViewDeps {
  box: HTMLElement;
  originalChildren: Node[];
  selfName: string | null;
}

function el<T extends HTMLElement>(tag: string, cls?: string, html?: string): T {
  const n = document.createElement(tag) as T;
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

export class View {
  private deps: ViewDeps;
  private tree: ReplyTree | null = null;
  private wrappers = new Map<number, HTMLElement>();
  private cells = new Map<number, HTMLElement>();
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private treeEl: HTMLElement;
  private headerEl: HTMLElement | null = null;
  private ctrlEl: HTMLElement;
  private statusEl: HTMLElement;
  private treeBtn: HTMLButtonElement;
  private rawBtn: HTMLButtonElement;
  private mode: ViewMode = 'tree';
  private mergedAll = false;
  private handleBoxClick = (e: MouseEvent) => this.onBoxClick(e);

  constructor(deps: ViewDeps) {
    this.deps = deps;
    this.toastEl = el('div', 'vxf-toast');
    document.body.appendChild(this.toastEl);
    this.treeEl = el('div', 'vxf-tree');

    this.ctrlEl = el('span', 'vxf-header-ctrl');
    this.statusEl = el('span', 'vxf-status');
    this.treeBtn = el<HTMLButtonElement>('button', 'vxf-mode-btn is-active', '对话树');
    this.rawBtn = el<HTMLButtonElement>('button', 'vxf-mode-btn', '原序');
    this.treeBtn.type = 'button';
    this.rawBtn.type = 'button';
    this.treeBtn.addEventListener('click', () => this.setMode('tree'));
    this.rawBtn.addEventListener('click', () => this.setMode('raw'));
    const seg = el('span', 'vxf-seg');
    seg.append(this.treeBtn, this.rawBtn);
    this.ctrlEl.append(this.statusEl, seg);

    this.mountHeader(deps.box);
    deps.box.addEventListener('click', this.handleBoxClick);
  }

  /* ---------- public API ---------- */

  getMode(): ViewMode {
    return this.mode;
  }

  setMode(mode: ViewMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.treeBtn.classList.toggle('is-active', mode === 'tree');
    this.rawBtn.classList.toggle('is-active', mode === 'raw');
    if (mode === 'tree') this.buildThread();
    else this.showOriginal();
  }

  setStatus(text: string, kind: 'muted' | 'warn' = 'muted') {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('vxf-status-warn', kind === 'warn');
    this.statusEl.hidden = !text;
  }

  setMergedAll(merged: boolean) {
    this.mergedAll = merged;
    if (this.mode === 'tree') {
      this.deps.box.classList.toggle('vxf-merged', merged);
    }
  }

  // 站方 AJAX 回复后会整体换掉回复 box，重新绑定并记录新的原始子节点
  retarget(box: HTMLElement) {
    this.deps.box.removeEventListener('click', this.handleBoxClick);
    this.deps.box = box;
    this.deps.originalChildren = Array.from(box.childNodes);
    this.mountHeader(box);
    box.addEventListener('click', this.handleBoxClick);
  }

  setData(tree: ReplyTree) {
    this.tree = tree;
  }

  toast(msg: string, kind: 'info' | 'warn' = 'info') {
    this.toastEl.textContent = msg;
    this.toastEl.classList.toggle('vxf-warn', kind === 'warn');
    this.toastEl.classList.add('vxf-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('vxf-visible'), 2600);
  }

  /* ---------- thread build ---------- */

  render() {
    if (this.mode === 'tree') this.buildThread();
    else this.showOriginal();
  }

  buildThread() {
    if (!this.tree) return;
    const box = this.deps.box;

    // Phase 2 增量合并时锁定当前视口内正在阅读的楼层，避免页面跳动
    let anchorNo: number | null = null;
    let anchorTop = 0;
    if (this.treeEl.isConnected && window.scrollY > 0) {
      const nodes = this.treeEl.querySelectorAll<HTMLElement>('.vxf-node');
      for (const n of nodes) {
        const rect = n.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
          const no = parseInt(n.dataset.no ?? '', 10);
          if (Number.isFinite(no)) {
            anchorNo = no;
            anchorTop = rect.top;
            break;
          }
        }
      }
    }

    if (!this.treeEl.isConnected || this.treeEl.parentElement !== box) {
      const firstReply = box.querySelector(':scope > div.cell[id^="r_"]');
      if (firstReply) box.insertBefore(this.treeEl, firstReply);
      else box.appendChild(this.treeEl);
    }

    this.cleanupAugmentations();
    this.wrappers.clear();
    this.cells.clear();
    box.classList.remove('vxf-raw');
    box.classList.add('vxf-threaded');
    box.classList.toggle('vxf-merged', this.mergedAll);

    const frag = document.createDocumentFragment();
    for (const r of this.tree.roots) frag.appendChild(this.buildNode(r));
    this.treeEl.replaceChildren(frag);

    if (anchorNo != null) {
      const target = this.wrappers.get(anchorNo);
      if (target) {
        const delta = target.getBoundingClientRect().top - anchorTop;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      }
    }
  }

  showOriginal() {
    const box = this.deps.box;
    this.cleanupAugmentations();
    this.wrappers.clear();
    this.cells.clear();
    this.treeEl.replaceChildren();
    box.replaceChildren(...this.deps.originalChildren);
    box.classList.remove('vxf-threaded', 'vxf-merged');
    box.classList.add('vxf-raw');
  }

  private mountHeader(box: HTMLElement) {
    this.headerEl = box.querySelector<HTMLElement>(':scope > div.cell:not([id^="r_"]):not(.ps_container)');
    if (!this.headerEl) return;
    this.headerEl.classList.add('vxf-header');
    if (this.ctrlEl.parentElement !== this.headerEl) {
      this.headerEl.appendChild(this.ctrlEl);
    }
  }

  private buildNode(floor: Floor): HTMLElement {
    const cell = floor.el as HTMLElement;
    this.cells.set(floor.no, cell);
    this.augmentCell(floor, cell);

    const node = el('div', 'vxf-node');
    node.dataset.no = String(floor.no);
    node.dataset.depth = String(floor.depth);
    node.appendChild(cell);

    if (floor.children.length) {
      const kids = el('div', 'vxf-kids');
      const inner = el('div', 'vxf-kids-inner');
      for (const c of floor.children) inner.appendChild(this.buildNode(c));
      kids.appendChild(inner);
      node.appendChild(kids);
    }
    this.wrappers.set(floor.no, node);
    return node;
  }

  private augmentCell(floor: Floor, cell: HTMLElement) {
    cell.classList.add('vxf-cell');
    cell.classList.toggle('vxf-nested', floor.depth > 0);

    const badges = cell.querySelector('.badges');
    if (badges && this.deps.selfName && floor.author === this.deps.selfName)
      badges.appendChild(el('span', 'vxf-badge vxf-self', '我'));

    const noEl = cell.querySelector<HTMLElement>('span.no');
    if (noEl) {
      noEl.classList.add('vxf-no');
      noEl.title = '点击定位该楼层';
    }

    if (this.tree) {
      cell.querySelectorAll<HTMLAnchorElement>('.reply_content a[href^="/member/"]').forEach((a) => {
        const prev = a.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE && /@\s*$/.test(prev.textContent ?? '')) {
          a.classList.add('vxf-mention');
          const name = memberName(a.getAttribute('href')) ?? '';
          const target = nearestAbove(this.tree!.byAuthor, name, floor.no);
          if (target) a.title = `回复 ${target.no} 楼（${target.author}）`;
          else a.classList.add('vxf-mention-unresolved');
        }
      });
    }
  }

  private cleanupAugmentations() {
    for (const cell of this.cells.values()) {
      cell.classList.remove('vxf-cell', 'vxf-nested', 'vxf-flash');
      cell.querySelectorAll('.vxf-badge').forEach((n) => n.remove());
      cell.querySelectorAll('.vxf-no').forEach((n) => {
        n.classList.remove('vxf-no');
        n.removeAttribute('title');
      });
      cell.querySelectorAll('.vxf-mention').forEach((n) => {
        n.classList.remove('vxf-mention', 'vxf-mention-unresolved');
        n.removeAttribute('title');
      });
    }
  }

  /* ---------- interactions ---------- */

  private onBoxClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const noEl = t.closest<HTMLElement>('span.vxf-no');
    if (noEl) {
      const node = noEl.closest<HTMLElement>('.vxf-node');
      if (node) this.jumpTo(parseInt(node.dataset.no!, 10));
    }
  }

  private jumpTo(no: number) {
    const node = this.wrappers.get(no);
    if (!node) {
      this.toast('未找到该楼层', 'warn');
      return;
    }
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const cell = this.cells.get(no);
    if (cell) {
      cell.classList.remove('vxf-flash');
      void cell.offsetWidth;
      cell.classList.add('vxf-flash');
      window.setTimeout(() => cell.classList.remove('vxf-flash'), 1900);
    }
  }
}
