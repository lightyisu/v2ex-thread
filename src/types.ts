export interface Mention {
  name: string;
  floorRef: number | null;
}

export interface Floor {
  replyId: string;
  no: number;
  author: string;
  time: string | null;
  mentions: Mention[];
  el: Element;
  page: number;
  targetNo: number | null;
  confidence: 'exact' | 'guess' | 'none';
  children: Floor[];
  depth: number;
  descendantCount: number;
}

export interface TopicMeta {
  title: string;
  author: string;
  totalPages: number;
  replyCount: number;
}

export interface TreeStats {
  total: number;
  roots: number;
  merged: number;
  exact: number;
  guess: number;
}