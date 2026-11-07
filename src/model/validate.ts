import { exceedsPortLimit, expandPortGroups, expandUnits, MAX_PORTS_PER_NODE, MAX_UNITS, resolvePortGroups } from './ports';
import { isValidPageSize, MAX_PAGE, MIN_PAGE } from './pageSize';
import { assetsIssue } from './images';
import { documentLimitIssue, MAX_EDGES_PER_PAGE, MAX_NODES_PER_PAGE, MAX_PORTS_PER_PAGE } from './docLimits';
import { isHexColor } from './signalActions';
import { CURRENT_VERSION, DOCUMENT_FORMAT } from './types';
import type { DiagramDocument, DeviceTemplate } from './types';

export interface ValidationResult {
  ok: boolean;
  /** 人が読めるエラー。検出した全件を返す(最初の1件で止めない) */
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 構造の検査で報告する件数の上限(壊れたファイルで、同じ種類の報告が延々と続かないように) */
const MAX_SHAPE_ERRORS = 20;

/**
 * 構造の検査。配列であるべき所が配列か、要素がオブジェクトかを確認する。
 * 後続の検査は、この構造を前提に反復・参照するため、壊れていれば先に止める(例外で落とさず、理由を返す)。
 */
function checkShape(doc: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const bad = (msg: string) => {
    if (errs.length < MAX_SHAPE_ERRORS) errs.push(msg);
  };
  const records = (name: string, list: unknown, required = true): list is Record<string, unknown>[] => {
    if (list === undefined && !required) return false;
    if (!Array.isArray(list)) {
      bad(`${name} は配列である必要があります`);
      return false;
    }
    list.forEach((x, i) => {
      if (!isRecord(x)) bad(`${name}[${i}] はオブジェクトである必要があります`);
    });
    return list.every(isRecord);
  };
  records('signalTypes', doc.signalTypes);
  if (records('deviceTemplates', doc.deviceTemplates)) {
    (doc.deviceTemplates as Record<string, unknown>[]).forEach((t, i) => records(`deviceTemplates[${i}].portGroups`, t.portGroups));
  }
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) {
    bad('pages は1ページ以上の配列である必要があります');
    return errs;
  }
  doc.pages.forEach((page, pi) => {
    if (!isRecord(page)) {
      bad(`pages[${pi}] はオブジェクトである必要があります`);
      return;
    }
    const nodesOk = records(`pages[${pi}].nodes`, page.nodes);
    records(`pages[${pi}].edges`, page.edges);
    records(`pages[${pi}].groups`, page.groups, false);
    if (nodesOk) {
      (page.nodes as Record<string, unknown>[]).forEach((n, ni) => {
        if (n.portGroupsOverride !== undefined) records(`pages[${pi}].nodes[${ni}].portGroupsOverride`, n.portGroupsOverride);
        if (n.portPlacements !== undefined && !isRecord(n.portPlacements)) bad(`pages[${pi}].nodes[${ni}].portPlacements はオブジェクトである必要があります`);
      });
    }
    if (Array.isArray(page.edges)) {
      (page.edges as unknown[]).forEach((e, ei) => {
        if (isRecord(e) && (!isRecord(e.from) || !isRecord(e.to))) bad(`pages[${pi}].edges[${ei}] の from / to はオブジェクトである必要があります`);
      });
    }
  });
  return errs;
}

const SIDE_VALUES: readonly string[] = ['left', 'right', 'top', 'bottom'];
const DIRECTION_VALUES: readonly string[] = ['in', 'out', 'inout'];
const SHAPE_VALUES: readonly string[] = ['rect', 'roundRect', 'ellipse'];

/**
 * 各項目の型の検査。文字列であるべき所が文字列か、数値であるべき所が有限の数か、決まった値のどれかであるべき所がそうか。
 * 構文として正しいJSONでも、型が違うと、描画の途中(エスケープや座標の計算)で例外になり、画面が壊れる
 * (例: 機器の名称が数値の `"label": 1`)。読み込みの時点で、理由つきで断る。構造(配列・オブジェクトか)は checkShape が確認済み。
 */
function checkFields(doc: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const bad = (msg: string) => {
    if (errs.length < MAX_SHAPE_ERRORS) errs.push(msg);
  };
  const str = (where: string, key: string, v: unknown, optional = false) => {
    if (optional && v === undefined) return;
    if (typeof v !== 'string') bad(`${where}.${key} は文字列である必要があります`);
  };
  const num = (where: string, key: string, v: unknown, optional = false) => {
    if (optional && v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${where}.${key} は有限の数値である必要があります`);
  };
  const oneOf = (where: string, key: string, v: unknown, list: readonly string[]) => {
    if (typeof v !== 'string' || !list.includes(v)) bad(`${where}.${key} は ${list.join(' / ')} のどれかである必要があります`);
  };
  const groups = (where: string, list: Record<string, unknown>[]) =>
    list.forEach((g, i) => {
      const w = `${where}[${i}]`;
      str(w, 'id', g.id);
      str(w, 'signalType', g.signalType);
      oneOf(w, 'direction', g.direction, DIRECTION_VALUES);
      oneOf(w, 'side', g.side, SIDE_VALUES);
      num(w, 'count', g.count);
      str(w, 'labelPrefix', g.labelPrefix);
    });

  const assetsProblem = assetsIssue(doc.assets);
  if (assetsProblem) bad(`assets: ${assetsProblem}`);
  if (doc.language !== undefined) oneOf('language', 'value', doc.language, ['ja', 'en']);
  const grid = doc.grid as Record<string, unknown>;
  if (grid.enabled !== undefined && typeof grid.enabled !== 'boolean') bad('grid.enabled は真偽値である必要があります');

  (doc.signalTypes as Record<string, unknown>[]).forEach((s, i) => {
    const w = `signalTypes[${i}]`;
    str(w, 'id', s.id);
    str(w, 'label', s.label);
    str(w, 'color', s.color);
  });
  (doc.deviceTemplates as Record<string, unknown>[]).forEach((t, i) => {
    const w = `deviceTemplates[${i}]`;
    str(w, 'id', t.id);
    str(w, 'name', t.name);
    str(w, 'kind', t.kind);
    oneOf(w, 'shape', t.shape, SHAPE_VALUES);
    str(w, 'iconRef', t.iconRef, true);
    groups(`${w}.portGroups`, t.portGroups as Record<string, unknown>[]);
  });
  (doc.pages as Record<string, unknown>[]).forEach((page, pi) => {
    const pw = `pages[${pi}]`;
    str(pw, 'id', page.id);
    str(pw, 'name', page.name);
    (page.nodes as Record<string, unknown>[]).forEach((n, ni) => {
      const w = `${pw}.nodes[${ni}]`;
      str(w, 'id', n.id);
      str(w, 'templateId', n.templateId);
      str(w, 'label', n.label);
      str(w, 'model', n.model);
      for (const k of ['x', 'y', 'w', 'h']) num(w, k, n[k]);
      if (typeof n.w === 'number' && n.w <= 0) bad(`${w}.w は正の数である必要があります`);
      if (typeof n.h === 'number' && n.h <= 0) bad(`${w}.h は正の数である必要があります`);
      num(w, 'count', n.count, true);
      str(w, 'note', n.note, true);
      str(w, 'iconOverride', n.iconOverride, true);
      str(w, 'imageId', n.imageId, true);
      if (typeof n.imageId === 'string' && !(isRecord(doc.assets) && typeof doc.assets[n.imageId] === 'string')) bad(`${w}.imageId「${n.imageId.slice(0, 40)}」の画像が assets にありません`);
      if (n.portGroupsOverride !== undefined) groups(`${w}.portGroupsOverride`, n.portGroupsOverride as Record<string, unknown>[]);
      if (isRecord(n.portPlacements)) {
        for (const [portId, placement] of Object.entries(n.portPlacements)) {
          const pl = `${w}.portPlacements[${portId}]`;
          if (!isRecord(placement)) {
            bad(`${pl} はオブジェクトである必要があります`);
            continue;
          }
          oneOf(pl, 'side', placement.side, SIDE_VALUES);
          num(pl, 'pos', placement.pos);
        }
      }
    });
    (page.edges as Record<string, unknown>[]).forEach((e, ei) => {
      const w = `${pw}.edges[${ei}]`;
      str(w, 'id', e.id);
      for (const end of ['from', 'to'] as const) {
        const ref = e[end] as Record<string, unknown>;
        str(`${w}.${end}`, 'nodeId', ref.nodeId);
        str(`${w}.${end}`, 'portId', ref.portId);
      }
      if (e.waypoints !== undefined) {
        if (!Array.isArray(e.waypoints)) bad(`${w}.waypoints は配列である必要があります`);
        else (e.waypoints as unknown[]).forEach((pt, k) => (isRecord(pt) ? (num(`${w}.waypoints[${k}]`, 'x', pt.x), num(`${w}.waypoints[${k}]`, 'y', pt.y)) : bad(`${w}.waypoints[${k}] はオブジェクトである必要があります`)));
      }
    });
    if (Array.isArray(page.groups)) {
      (page.groups as Record<string, unknown>[]).forEach((f, fi) => {
        const w = `${pw}.groups[${fi}]`;
        str(w, 'id', f.id);
        str(w, 'label', f.label);
        for (const k of ['x', 'y', 'w', 'h']) num(w, k, f[k]);
      });
    }
  });
  return errs;
}

const LIMIT_TEXT = {
  nodes: `1ページあたりの機器は${MAX_NODES_PER_PAGE}台までです`,
  ports: `1ページあたりのポートの合計(台数ぶんを含む)は${MAX_PORTS_PER_PAGE}個までです`,
  edges: `1ページあたりの接続は${MAX_EDGES_PER_PAGE}本までです`,
} as const;

/**
 * 読み込んだJSONの検証。構造と参照整合性を調べる。
 * 不正なデータを黙って受け入れず、原因が分かるメッセージで返す(Fail-Fast)。
 */
export function validateDocument(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ['ドキュメントがオブジェクトではありません'] };
  }
  if (input.format !== DOCUMENT_FORMAT) {
    errors.push(`このアプリのファイル形式ではありません: format = ${String(input.format)}(期待: ${DOCUMENT_FORMAT})`);
  }
  if (input.version !== CURRENT_VERSION) {
    errors.push(`未対応のバージョンです: ${String(input.version)}(対応: ${CURRENT_VERSION})`);
  }
  const grid = input.grid;
  if (!isRecord(grid) || !Number.isInteger(grid.size) || (grid.size as number) <= 0) {
    errors.push('grid.size は正の整数である必要があります');
  }
  if (errors.length > 0) return { ok: false, errors };
  const shapeErrors = checkShape(input);
  if (shapeErrors.length > 0) return { ok: false, errors: shapeErrors };
  const fieldErrors = checkFields(input);
  if (fieldErrors.length > 0) return { ok: false, errors: fieldErrors };
  // 図全体の大きさの上限(展開や参照の検査の前に確認する。巨大なファイルで、検証そのものが固まらないように)
  const issue = documentLimitIssue(input as unknown as DiagramDocument);
  if (issue) return { ok: false, errors: [LIMIT_TEXT[issue]] };

  const doc = input as unknown as DiagramDocument;
  const signalIds = new Set<string>();
  for (const s of doc.signalTypes) {
    if (signalIds.has(s.id)) errors.push(`信号種別IDが重複しています: ${s.id}`);
    signalIds.add(s.id);
    if (!isHexColor(s.color)) errors.push(`信号種別 ${s.id} の色が #RRGGBB 形式ではありません: ${String(s.color)}`);
  }
  const templates = new Map<string, DeviceTemplate>();
  for (const t of doc.deviceTemplates) {
    if (templates.has(t.id)) errors.push(`テンプレートIDが重複しています: ${t.id}`);
    templates.set(t.id, t);
    checkPortGroups(`テンプレート ${t.id}`, t.portGroups, signalIds, errors);
  }

  for (const page of doc.pages) {
    const where = `ページ ${page.id}`;
    if (!isRecord(page.size) || !isValidPageSize(page.size)) {
      errors.push(`${where}: ページの大きさが不正です(幅${MIN_PAGE.w}〜${MAX_PAGE}、高さ${MIN_PAGE.h}〜${MAX_PAGE}の整数)`);
    }
    const nodeIds = new Set<string>();
    const portsByNode = new Map<string, Set<string>>();
    for (const n of page.nodes) {
      if (nodeIds.has(n.id)) errors.push(`${where}: 機器IDが重複しています: ${n.id}`);
      nodeIds.add(n.id);
      const tpl = templates.get(n.templateId);
      if (!tpl) {
        errors.push(`${where}: 機器 ${n.id} が存在しないテンプレートを参照しています: ${n.templateId}`);
        continue;
      }
      const groups = resolvePortGroups(tpl, n);
      // 展開する前に上限を確認する(巨大な台数・ポート数のファイルで、検証そのものが固まらないように。
      // グループ定義の検査も内部で展開するので、それより先に行う)
      if (exceedsPortLimit(groups, n.count ?? 1)) {
        errors.push(`${where}: 機器 ${n.id} の台数またはポート数が上限を超えています(台数は1〜${MAX_UNITS}の整数、ポートの合計は台数ぶんを含めて1機器あたり${MAX_PORTS_PER_NODE}まで)`);
        continue;
      }
      if (n.portGroupsOverride) {
        checkPortGroups(`機器 ${n.id}`, groups, signalIds, errors);
      }
      try {
        const ids = new Set(expandUnits(expandPortGroups(groups), n.count ?? 1).map((p) => p.id));
        portsByNode.set(n.id, ids);
        checkPortPlacements(n.id, n.portPlacements, ids, errors);
      } catch {
        // 不正なグループ定義は checkPortGroups が報告済み
      }
    }
    const frameIds = new Set<string>();
    for (const f of page.groups ?? []) {
      if (frameIds.has(f.id)) errors.push(`${where}: 枠IDが重複しています: ${f.id}`);
      frameIds.add(f.id);
      if (typeof f.label !== 'string' || ![f.x, f.y, f.w, f.h].every(Number.isFinite) || f.w <= 0 || f.h <= 0) {
        errors.push(`${where}: 枠 ${f.id} の名称・位置・大きさが不正です`);
      }
    }
    const edgeIds = new Set<string>();
    for (const e of page.edges) {
      if (edgeIds.has(e.id)) errors.push(`${where}: 接続IDが重複しています: ${e.id}`);
      edgeIds.add(e.id);
      for (const end of [e.from, e.to]) {
        if (!nodeIds.has(end.nodeId)) {
          errors.push(`${where}: 接続 ${e.id} が存在しない機器を参照しています: ${end.nodeId}`);
        } else if (portsByNode.get(end.nodeId)?.has(end.portId) === false) {
          errors.push(`${where}: 接続 ${e.id} が存在しないポートを参照しています: ${end.nodeId}/${end.portId}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function checkPortPlacements(
  nodeId: string,
  placements: unknown,
  portIds: Set<string>,
  errors: string[],
): void {
  if (placements === undefined) return;
  if (!isRecord(placements)) {
    errors.push(`機器 ${nodeId}: portPlacements はオブジェクトである必要があります`);
    return;
  }
  for (const [portId, value] of Object.entries(placements)) {
    if (!portIds.has(portId)) {
      errors.push(`機器 ${nodeId}: portPlacements が存在しないポートを指しています: ${portId}`);
    }
    if (!isRecord(value) || !SIDE_VALUES.includes(value.side as string) || typeof value.pos !== 'number' || !Number.isFinite(value.pos)) {
      errors.push(`機器 ${nodeId}: portPlacements の ${portId} は { side, pos } の形式である必要があります`);
    }
  }
}

function checkPortGroups(
  owner: string,
  groups: DeviceTemplate['portGroups'],
  signalIds: Set<string>,
  errors: string[],
): void {
  // 展開(=個数ぶんの繰り返し)の前に上限を確認する。テンプレートの定義が巨大でも、検証が固まらないように
  if (exceedsPortLimit(groups, 1)) {
    errors.push(`${owner}: ポート数が上限を超えています(ポートの合計は1機器あたり${MAX_PORTS_PER_NODE}まで)`);
    return;
  }
  try {
    expandPortGroups(groups);
  } catch (err) {
    errors.push(`${owner}: ${(err as Error).message}`);
  }
  for (const g of groups) {
    if (g.multi !== undefined && typeof g.multi !== 'boolean') {
      errors.push(`${owner}: ポートグループ ${g.id} の multi は真偽値である必要があります`);
    }
    if (!signalIds.has(g.signalType)) {
      errors.push(`${owner}: ポートグループ ${g.id} が未定義の信号種別を参照しています: ${g.signalType}`);
    }
  }
}
