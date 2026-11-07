import { frameOfNode } from '../model/frames';
import { getNodePorts, getTemplate } from '../model/query';
import type { DiagramDocument } from '../model/types';

export interface DeviceCsvHeaders {
  name: string;
  model: string;
  quantity: string;
  kind: string;
  ports: string;
  place: string;
}

/** Excelが UTF-8 と判定して文字化けしないための先頭マーク */
export const CSV_BOM = '﻿';

/**
 * CSVの1セルを書き出す。区切り・引用符・改行を含む値は引用符で囲む。
 * 表計算ソフトで開いたとき数式として実行されないよう、= + - @ やタブ・復帰で始まる値は先頭に ' を付ける
 * (CSVインジェクション対策)。
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * 図に使われている機器の一覧(名称・型番・台数・種類・ポート数・場所)をCSVにする。
 * 名称・型番・種類・場所(属する枠の名称。入れ子なら内側の枠)が同じ機器は1行にまとめ、
 * 台数を合計する(台数表記が無い機器は1台)。並びは図に最初に現れた順。ポート数は1台あたり。
 */
export function buildDeviceCsv(doc: DiagramDocument, headers: DeviceCsvHeaders): string {
  const rows = new Map<string, { name: string; model: string; kind: string; place: string; quantity: number; ports: number }>();
  for (const page of doc.pages) {
    for (const n of page.nodes) {
      const kind = getTemplate(doc, n.templateId)?.name ?? '';
      const place = frameOfNode(page, n)?.label ?? '';
      const key = JSON.stringify([n.label, n.model, kind, place]);
      const row = rows.get(key);
      const qty = n.count ?? 1;
      if (row) row.quantity += qty;
      else rows.set(key, { name: n.label, model: n.model, kind, place, quantity: qty, ports: getNodePorts(doc, n).filter((p) => p.unit === 1).length });
    }
  }
  const lines = [[headers.name, headers.model, headers.quantity, headers.kind, headers.ports, headers.place]];
  for (const r of rows.values()) lines.push([r.name, r.model, String(r.quantity), r.kind, String(r.ports), r.place]);
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
