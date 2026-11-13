import type { Floor, TreeStats } from './types';

export interface ReplyTree {
  roots: Floor[];
  byNo: Map<number, Floor>;
  byAuthor: Map<string, Floor[]>;
  stats: TreeStats;
}

export function nearestAbove(
  byAuthor: Map<string, Floor[]>,
  name: string,
  beforeNo: number
): Floor | null {
  const list = byAuthor.get(name);
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].no < beforeNo) return list[i];
  }
  return null;
}

export function buildTree(floors: Floor[]): ReplyTree {
  const sorted = [...floors].sort((a, b) => a.no - b.no);
  const byNo = new Map<number, Floor>();
  const byAuthor = new Map<string, Floor[]>();
  for (const f of sorted) {
    f.children = [];
    f.targetNo = null;
    f.confidence = 'none';
    f.depth = 0;
    f.descendantCount = 0;
    byNo.set(f.no, f);
    const list = byAuthor.get(f.author);
    if (list) list.push(f);
    else byAuthor.set(f.author, [f]);
  }

  const roots: Floor[] = [];
  let exact = 0;
  let guess = 0;

  for (const floor of sorted) {
    let target: Floor | null = null;
    let confidence: Floor['confidence'] = 'none';
    for (const m of floor.mentions) {
      if (m.floorRef != null) {
        const t = byNo.get(m.floorRef);
        if (t && t.no < floor.no) {
          target = t;
          confidence = 'exact';
          break;
        }
      }
      const t = nearestAbove(byAuthor, m.name, floor.no);
      if (t) {
        target = t;
        confidence = 'guess';
        break;
      }
    }
    if (target) {
      floor.targetNo = target.no;
      floor.confidence = confidence;
      target.children.push(floor);
      if (confidence === 'exact') exact++;
      else guess++;
    } else {
      roots.push(floor);
    }
  }

  const visit = (f: Floor, depth: number): number => {
    f.depth = depth;
    let count = 0;
    for (const c of f.children) count += 1 + visit(c, depth + 1);
    f.descendantCount = count;
    return count;
  };
  for (const r of roots) visit(r, 0);

  return {
    roots,
    byNo,
    byAuthor,
    stats: {
      total: sorted.length,
      roots: roots.length,
      merged: sorted.length - roots.length,
      exact,
      guess,
    },
  };
}