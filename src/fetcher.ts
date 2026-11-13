import { parseFloors } from './parse';
import type { Floor } from './types';

export interface FetchOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

async function fetchPageHtml(topic: string, p: number, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/t/${topic}?p=${p}`, { credentials: 'same-origin', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function loadForeignFloors(
  topic: string,
  pages: number[],
  opts: FetchOptions = {}
): Promise<{ floors: Floor[]; failed: number[]; aborted: boolean }> {
  const floors: Floor[] = [];
  const failed: number[] = [];
  const queue = [...pages];
  const total = pages.length;
  let done = 0;
  let aborted = false;

  const worker = async () => {
    while (queue.length) {
      if (opts.signal?.aborted) {
        aborted = true;
        return;
      }
      const p = queue.shift()!;
      try {
        const html = await fetchPageHtml(topic, p, opts.signal);
        if (opts.signal?.aborted) {
          aborted = true;
          return;
        }
        const doc = new DOMParser().parseFromString(html, 'text/html');
        floors.push(...parseFloors(doc, p));
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || opts.signal?.aborted) {
          aborted = true;
          return;
        }
        failed.push(p);
      } finally {
        done++;
        opts.onProgress?.(done, total);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { floors, failed, aborted };
}