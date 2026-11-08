// データモデルの型定義。設計書 4章に対応する。
// 接続データ(edges)が正本であり、線の色や描画位置は描画時に導出する(SSOT)。

/**
 * ファイル形式の識別子。アプリ名を含めない中立の値にして、
 * アプリ名を変えても既存の保存ファイルが読めるようにする。
 */
export const DOCUMENT_FORMAT = 'system-diagram';

/** スキーマ版。保存形式を変えるときに上げ、読込時にマイグレーションする */
export const CURRENT_VERSION = 1;

export type Side = 'left' | 'right' | 'top' | 'bottom';
export type Direction = 'in' | 'out' | 'inout';
export type Shape = 'rect' | 'roundRect' | 'ellipse';
export type Language = 'ja' | 'en';

export interface SignalType {
  id: string;
  label: string;
  /** 線の色(CSSの色指定) */
  color: string;
}

/** ポートのグループ定義。実体は派生させる(例: LAN x 24) */
export interface PortGroup {
  id: string;
  signalType: string;
  direction: Direction;
  side: Side;
  count: number;
  labelPrefix: string;
  /** 1つのポートに複数の線を接続できる(ハイインピーダンスのスピーカーの並列など)。省略は1本まで */
  multi?: boolean;
}

export interface DeviceTemplate {
  id: string;
  name: string;
  /** 既定アイコンの選択に使う機器の種類(camera / amp / switch など) */
  kind: string;
  shape: Shape;
  iconRef?: string;
  /** 登録した機器を置くときに使う画像(図の assets の ID) */
  imageId?: string;
  /** 登録した機器を置くときの大きさ。標準機器は省略し、自動サイズを使う */
  size?: { w: number; h: number };
  portGroups: PortGroup[];
}

export interface DiagramNode {
  id: string;
  templateId: string;
  label: string;
  model: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 台数表記(×N台) */
  count?: number;
  iconOverride?: string;
  /** 機器の中に表示する画像(図の assets の ID)。なければ、種類ごとの小さなアイコンを出す */
  imageId?: string;
  note?: string;
  /** 機器ごとにテンプレートと別のポート構成にする場合 */
  portGroupsOverride?: PortGroup[];
  /**
   * 個別に動かしたポートの位置(ポートID → 辺と、辺に沿った位置)。
   * 位置は機器の左上を原点とする相対値。無いポートは自動配置に従う。
   */
  portPlacements?: Record<string, ManualPortPlacement>;
}

export interface ManualPortPlacement {
  side: Side;
  /** 辺に沿った位置(左右の辺ならY、上下の辺ならX) */
  pos: number;
}

export interface PortRef {
  nodeId: string;
  portId: string;
}

export interface DiagramEdge {
  id: string;
  from: PortRef;
  to: PortRef;
  /** 手動で曲げた経路。自動配線より優先する */
  waypoints?: { x: number; y: number }[];
}

export interface DiagramGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 旧形式の所属リスト。現在は使わない(所属は、機器の中心が枠の中にあるかで毎回決める)。
   * 古いファイルを読めるよう、項目だけ残す。
   */
  memberNodeIds?: string[];
}

export interface Page {
  id: string;
  name: string;
  size: { w: number; h: number };
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: DiagramGroup[];
}

export interface GridSettings {
  size: number;
  enabled: boolean;
}

export interface DiagramDocument {
  format: typeof DOCUMENT_FORMAT;
  version: number;
  language: Language;
  grid: GridSettings;
  signalTypes: SignalType[];
  deviceTemplates: DeviceTemplate[];
  /** 取込アイコン: assetId -> data URI */
  assets: Record<string, string>;
  pages: Page[];
}
