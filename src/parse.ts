import type { Floor, Mention, TopicMeta } from './types';

const MEMBER_HREF = /^\/member\/([^/?#]+)/;

export function memberName(href: string | null): string | null {
  if (!href) return null;
  const m = MEMBER_HREF.exec(href);
  return m ? decodeURIComponent(m[1]) : null;
}

export function parseTopic(doc: Document): TopicMeta {
  const title = doc.querySelector('.header h1')?.textContent?.trim() ?? '';
  const author =
    memberName(
      doc.querySelector('.header small.gray a[href^="/member/"]')?.getAttribute('href') ??
        doc.querySelector('.header a[href^="/member/"]')?.getAttribute('href') ??
        null
    ) ?? '';
  let totalPages = 1;
  const pageInput = doc.querySelector('input.page_input');
  if (pageInput?.getAttribute('max')) {
    totalPages = Math.max(1, parseInt(pageInput.getAttribute('max')!, 10) || 1);
  } else {
    doc.querySelectorAll('a.page_normal, a.page_current').forEach((a) => {
      const n = parseInt(a.textContent ?? '', 10);
      if (n > totalPages) totalPages = n;
    });
  }
  let replyCount = 0;
  doc.querySelectorAll('span.gray').forEach((s) => {
    const m = /(\d+)\s*replies/.exec(s.textContent ?? '');
    if (m) replyCount = parseInt(m[1], 10);
  });
  return { title, author, totalPages, replyCount };
}

const LEADING_MENTION =
  /^\s*(?:<br\s*\/?>\s*)*@<a\b[^>]*href="\/member\/([^"]+)"[^>]*>[\s\S]*?<\/a>[^\S\n]*(?:#(\d+))?/;

export function parseLeadingMentions(content: Element | null): Mention[] {
  if (!content) return [];
  const html = content.innerHTML;
  const mentions: Mention[] = [];
  let offset = 0;
  while (offset < html.length) {
    const m = LEADING_MENTION.exec(html.slice(offset));
    if (!m) break;
    mentions.push({
      name: decodeURIComponent(m[1]),
      floorRef: m[2] ? parseInt(m[2], 10) : null,
    });
    offset += m[0].length;
    if (mentions.length >= 12) break;
  }
  return mentions;
}

export function parseFloors(doc: Document, page: number): Floor[] {
  const floors: Floor[] = [];
  const seen = new Set<string>();
  doc.querySelectorAll('div.cell[id^="r_"]').forEach((cell) => {
    const id = cell.getAttribute('id') ?? '';
    const replyId = id.slice(2);
    if (!replyId || seen.has(replyId)) return;
    seen.add(replyId);
    const no = parseInt(cell.querySelector('span.no')?.textContent ?? '', 10);
    if (!Number.isFinite(no)) return;
    const author = memberName(
      cell.querySelector('strong a[href^="/member/"]')?.getAttribute('href') ?? null
    );
    if (!author) return;
    const content = cell.querySelector('.reply_content');
    floors.push({
      replyId,
      no,
      author,
      time: cell.querySelector('span.ago')?.getAttribute('title') ?? null,
      mentions: parseLeadingMentions(content),
      el: cell,
      page,
      targetNo: null,
      confidence: 'none',
      children: [],
      depth: 0,
      descendantCount: 0,
    });
  });
  return floors;
}