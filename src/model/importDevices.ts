import { addNodeFromTemplate, updateNode } from './actions';
import type { Action, ActionResult } from './actions';
import { ceilToGrid } from './grid';
import { uniqueId } from './ids';
import { autoNodeSize, estimateTextWidth } from './nodeSize';
import { getPage } from './query';
import type { DeviceTemplate } from './types';

/** 読み込む1行(検証済み。CSVの解析は io/csvImport.ts が行う) */
export interface ImportRow {
  name: string;
  model: string;
  /** 台数(1以上の整数)。2以上なら、1つの機器の台数として入れる */
  quantity: number;
  /** 標準機器のID(不明な種類は呼び出し側が 'generic' にする) */
  presetId: string;
  /** 場所。同じ場所の機器を、同じ名称の枠にまとめる。空なら枠なし */
  place: string;
}

export interface ImportOptions {
  /** 標準機器のIDから、図へ取り込むテンプレートを作る(名称は画面の言語で付ける。モデルは言語を持たない) */
  templateFor(presetId: string): DeviceTemplate;
}

/** 枠の上の見出し(名称)の高さ */
const FRAME_HEADER = 30;

interface Planned {
  row: ImportRow;
  tpl: DeviceTemplate;
  w: number;
  h: number;
  x: number;
  y: number;
}

/**
 * 機器一覧(CSVの行)から、機器と枠をまとめて追加する。接続は作らない。
 * - 場所が同じ機器を1つの枠にまとめ(出現順)、枠の中へ左から右へ折り返して並べる。場所が空の機器は、枠なしで最後に並べる。
 * - 既存の機器・枠の下から始め(重ならない)、ページに収まらない分は置かない(ページは大きくしない)。
 *   置けなかった機器の名称は unplaced で返す。1台も置けないときは 'import-no-space' で断り、何も変えない。
 * - 台数が2以上の行は、1つの機器の台数として入れる(台数ぶんのポートが付く)。
 */
export function importDevices(pageId: string, rows: readonly ImportRow[], options: ImportOptions): Action {
  return (doc): ActionResult => {
    const page = getPage(doc, pageId);
    if (!page) return { ok: false, error: 'unknown-page' };
    const g = doc.grid.size;
    const margin = 2 * g;
    const gap = 2 * g;
    const pad = 2 * g;
    const header = ceilToGrid(FRAME_HEADER, g);
    const pageW = page.size.w;
    const pageH = page.size.h;

    // 場所ごとにまとめる(出現順)。枠なし(場所が空)は最後
    const buckets = new Map<string, Planned[]>();
    for (const row of rows) {
      const tpl = options.templateFor(row.presetId);
      const size = autoNodeSize({ groups: tpl.portGroups, label: row.name, model: row.model, grid: g, units: row.quantity > 1 ? row.quantity : undefined });
      const list = buckets.get(row.place) ?? [];
      list.push({ row, tpl, w: size.w, h: size.h, x: 0, y: 0 });
      buckets.set(row.place, list);
    }
    const order = [...buckets.keys()].filter((k) => k !== '');
    if (buckets.has('')) order.push('');

    // 既存の内容の下から始める
    const bottoms = [...page.nodes.map((n) => n.y + n.h), ...page.groups.map((f) => f.y + f.h)];
    let cursorY = bottoms.length > 0 ? ceilToGrid(Math.max(...bottoms) + gap, g) : margin;

    const frames: { label: string; x: number; y: number; w: number; h: number }[] = [];
    const placed: Planned[] = [];
    const unplaced: string[] = [];
    let overflow = false;

    for (const place of order) {
      const items = buckets.get(place)!;
      if (overflow) {
        unplaced.push(...items.map((i) => i.row.name));
        continue;
      }
      const framed = place !== '';
      const innerLeft = margin + (framed ? pad : 0);
      const maxW = pageW - margin - (framed ? pad : 0) - innerLeft;
      const bottomLimit = pageH - margin - (framed ? pad : 0);
      let x = innerLeft;
      let y = cursorY + (framed ? header : 0);
      let rowH = 0;
      let usedW = 0;
      const here: Planned[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.w > maxW) {
          unplaced.push(item.row.name); // 幅だけでページに収まらない機器は、飛ばして次へ
          continue;
        }
        if (x > innerLeft && x + item.w > innerLeft + maxW) {
          x = innerLeft;
          y += rowH + gap;
          rowH = 0;
        }
        if (y + item.h > bottomLimit) {
          overflow = true;
          unplaced.push(...items.slice(i).map((r) => r.row.name));
          break;
        }
        item.x = x;
        item.y = y;
        here.push(item);
        x += item.w + gap;
        rowH = Math.max(rowH, item.h);
        usedW = Math.max(usedW, x - gap - innerLeft);
      }
      if (here.length === 0) continue;
      placed.push(...here);
      const bottom = y + rowH;
      if (framed) {
        // 枠の幅は、機器と名称(場所)が入る幅。ただしページの幅を超えない(名称が長すぎる場合は、名称の側が切れる)
        const w = Math.min(Math.max(usedW + 2 * pad, ceilToGrid(estimateTextWidth(place) + 2 * pad, g)), pageW - 2 * margin);
        const h = ceilToGrid(bottom + pad - cursorY, g);
        frames.push({ label: place, x: margin, y: cursorY, w, h });
        cursorY += h + gap;
      } else {
        cursorY = ceilToGrid(bottom + gap, g);
      }
    }

    if (placed.length === 0) return { ok: false, error: 'import-no-space', blockers: unplaced };

    const createdFrameIds: string[] = [];
    for (const f of frames) {
      const id = uniqueId('g', page.groups.map((x) => x.id));
      page.groups.push({ id, ...f });
      createdFrameIds.push(id);
    }
    const createdNodeIds: string[] = [];
    for (const p of placed) {
      const r = addNodeFromTemplate(pageId, p.tpl, p.row.name, { x: p.x, y: p.y })(doc);
      if (!r.ok || !r.created) return r;
      const patch: { model?: string; count?: number } = {};
      if (p.row.model !== '') patch.model = p.row.model;
      if (p.row.quantity > 1) patch.count = p.row.quantity;
      if (Object.keys(patch).length > 0) {
        const u = updateNode(pageId, r.created, patch)(doc);
        if (!u.ok) return u;
      }
      createdNodeIds.push(r.created);
    }
    return { ok: true, createdNodeIds, createdFrameIds, ...(unplaced.length > 0 ? { unplaced } : {}) };
  };
}
