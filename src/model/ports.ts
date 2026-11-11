import type { Direction, DeviceTemplate, DiagramNode, PortGroup, Side } from './types';

/** グループ定義から派生した、個々のポート */
export interface Port {
  id: string;
  groupId: string;
  /** グループ内の番号(1始まり) */
  index: number;
  label: string;
  /** 番号だけの短い表示名(ポートが1つだけのグループは label と同じ)。上辺・下辺では、隣のポートと文字が重ならないよう、図にはこちらを出す */
  shortLabel?: string;
  signalType: string;
  direction: Direction;
  side: Side;
  /** 何台目のポートか(1始まり)。台数が複数の機器で、台ごとに独立したポートを持つ */
  unit: number;
  /** 複数の線を接続できるポートか */
  multi: boolean;
}

/**
 * 入力と入力、出力と出力の接続か。「入出力」はどちらとも組める。
 * どちらかが複数接続可のポートなら、並列接続(スピーカー同士の入力など)とみなして不一致にしない。
 */
export function isDirectionMismatch(a: Pick<Port, 'direction' | 'multi'>, b: Pick<Port, 'direction' | 'multi'>): boolean {
  if (a.multi || b.multi) return false;
  return a.direction !== 'inout' && a.direction === b.direction;
}

/** 台数の上限。これを超える値は入力ミスとみなして断る(台数ぶんのポートが展開されるため) */
export const MAX_UNITS = 999;

/**
 * 1機器あたりのポートの合計の上限(台数ぶんを含む)。ポートは画面にセルとして描かれるため、
 * 極端に大きな値(ファイルや入力欄に書かれた 10 億台など)でブラウザが固まらないようにする。
 * 実際の機器(48ポートのスイッチ、16台ぶんのスピーカなど)より十分に大きい値にしてある。
 */
export const MAX_PORTS_PER_NODE = 5000;

/** 展開の繰り返しを制限するため、欠番を含む1台あたりの公称個数にも上限を設ける。 */
export const MAX_NOMINAL_PORTS_PER_UNIT = 50000;

/** 不正な欠番は差し引かず、後段の検証で拒否する。 */
export function realPortCount(count: unknown, skipped: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isInteger(count) || count > MAX_NOMINAL_PORTS_PER_UNIT || !Array.isArray(skipped) || skipped.length > count) return count;
  let previous = 0;
  for (const value of skipped) {
    if (!Number.isInteger(value) || value <= previous || value > count) return count;
    previous = value;
  }
  return count - skipped.length;
}

/**
 * 台数とポート構成が、上限を超えるか(展開する前に判定する。展開してから調べると、その展開で固まるため)。
 * 台数が整数でない・範囲外のときも、超えるものとして扱う。
 */
export function exceedsPortLimit(groups: readonly Pick<PortGroup, 'count' | 'skipped'>[], units: number): boolean {
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS) return true;
  let nominal = 0;
  let actual = 0;
  for (const g of groups) {
    nominal += typeof g.count === 'number' && Number.isFinite(g.count) && g.count > 0 ? g.count : 0;
    if (nominal > MAX_NOMINAL_PORTS_PER_UNIT) return true;
    actual += realPortCount(g.count, g.skipped);
    if (actual * units > MAX_PORTS_PER_NODE) return true;
  }
  return false;
}

/** ポートIDは「グループID-番号」。接続(Edge)はこのIDでポートを指す */
export function portId(groupId: string, index: number): string {
  return `${groupId}-${index}`;
}

/**
 * ポートの表示名。ポートが1つだけのグループには番号を付けない(区別する相手がいないため。「LAN」「IN」)。
 * 2つ以上なら「表示名+番号」。表示名が空で番号も付けない場合は、空にせず番号を使う。
 */
export function portLabel(group: Pick<PortGroup, 'labelPrefix' | 'count' | 'startNumber'>, index: number): string {
  const number = (group.startNumber ?? 1) + index - 1;
  if (group.count === 1) {
    const bare = group.labelPrefix.trim();
    return bare !== '' ? bare : String(number);
  }
  return `${group.labelPrefix}${number}`;
}

/**
 * ポートグループを個々のポートへ展開する。
 * 不正な個数や重複したグループIDは、黙って直さず例外にする(Fail-Fast)。
 */
export function expandPortGroups(groups: readonly PortGroup[]): Port[] {
  if (groups.reduce((sum, g) => sum + (typeof g.count === 'number' && Number.isFinite(g.count) && g.count > 0 ? g.count : 0), 0) > MAX_NOMINAL_PORTS_PER_UNIT) throw new RangeError('Nominal port count exceeds safety limit');
  const seen = new Set<string>();
  const ports: Port[] = [];
  for (const g of groups) {
    if (seen.has(g.id)) {
      throw new RangeError(`ポートグループIDが重複しています: ${g.id}`);
    }
    seen.add(g.id);
    if (!Number.isInteger(g.count) || g.count < 0) {
      throw new RangeError(`ポート数が不正です(0以上の整数): ${g.id} = ${g.count}`);
    }
    if (g.startNumber !== undefined && (!Number.isInteger(g.startNumber) || g.startNumber < 0 || g.startNumber > 9999)) throw new RangeError(`Invalid startNumber: ${g.id}`);
    if (g.skipped !== undefined && (!Array.isArray(g.skipped) || realPortCount(g.count, g.skipped) !== g.count - g.skipped.length)) throw new RangeError(`Invalid skipped: ${g.id}`);
    const skipped = new Set(g.skipped);
    for (let n = 1; n <= g.count; n++) {
      if (skipped.has(n)) continue;
      ports.push({
        id: portId(g.id, n),
        groupId: g.id,
        index: n,
        label: portLabel(g, n),
        shortLabel: g.count === 1 ? portLabel(g, n) : String((g.startNumber ?? 1) + n - 1),
        signalType: g.signalType,
        direction: g.direction,
        side: g.side,
        unit: 1,
        multi: g.multi === true,
      });
    }
  }
  return ports;
}

/**
 * 台数ぶんのポートへ展開する。1台目のIDは従来と同じ(古いファイルと互換)、2台目以降は「ID@台番号」。
 * 並びは台ごとにまとめる(台の切れ目は、配置側で1枠あける)。
 */
export function expandUnits(base: readonly Port[], units: number): Port[] {
  const count = Number.isInteger(units) && units > 1 ? units : 1;
  const result: Port[] = [...base];
  for (let u = 2; u <= count; u++) {
    for (const p of base) result.push({ ...p, id: `${p.id}@${u}`, unit: u });
  }
  return result;
}

/** 機器のポート構成を決める。機器ごとの上書きがあればテンプレートより優先する */
export function resolvePortGroups(template: DeviceTemplate, node: DiagramNode): PortGroup[] {
  return node.portGroupsOverride ?? template.portGroups;
}

export function findPort(ports: readonly Port[], id: string): Port | undefined {
  return ports.find((p) => p.id === id);
}
