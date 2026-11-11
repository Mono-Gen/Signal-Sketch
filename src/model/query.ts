import { layoutPorts } from './portLayout';
import { ceilToGrid } from './grid';
import { BOTTOM_LABEL_ROW, SIDE_LABEL_EXTRA, TOP_LABEL_SHIFT } from './portMarker';
import type { PortPlacement } from './portLayout';
import { expandPortGroups, expandUnits, resolvePortGroups } from './ports';
import type { Port } from './ports';
import type { DiagramDocument, DiagramNode, DeviceTemplate, Page, PortRef } from './types';

export function getPage(doc: DiagramDocument, pageId: string): Page | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export function getTemplate(doc: DiagramDocument, templateId: string): DeviceTemplate | undefined {
  return doc.deviceTemplates.find((t) => t.id === templateId);
}

/** 機器のポート一覧(上書き・台数を考慮。台数が複数なら台数ぶん)。テンプレートが無ければ空 */
export function getNodePorts(doc: DiagramDocument, node: DiagramNode): Port[] {
  const tpl = getTemplate(doc, node.templateId);
  return tpl ? expandUnits(expandPortGroups(resolvePortGroups(tpl, node)), node.count ?? 1) : [];
}

/** 接続の端(機器ID+ポートID)が指すポート。1ページ目の機器から探す。無ければ undefined */
export function findPortByRef(doc: DiagramDocument, ref: PortRef): Port | undefined {
  const node = doc.pages[0].nodes.find((n) => n.id === ref.nodeId);
  return node ? getNodePorts(doc, node).find((p) => p.id === ref.portId) : undefined;
}

/** 機器のポートの配置(個別に動かした位置を考慮)。線が出る向きも、ここで決まる辺に従う */
export function layoutNodePorts(doc: DiagramDocument, node: DiagramNode): PortPlacement[] {
  return layoutPorts(getNodePorts(doc, node), { w: node.w, h: node.h }, doc.grid.size, node.portPlacements, portHeaderExtra(doc, node), portFooterExtra(doc, node));
}

export { SIDE_LABEL_EXTRA, TOP_LABEL_SHIFT } from './portMarker';

/** 機器の名前・アイコンを下へずらす量。上辺にポートがあって、番号を表示しているときだけ(他は0) */
export function headerShift(doc: DiagramDocument, node: DiagramNode): number {
  if (!node.showPortLabels) return 0;
  // 配置(layoutNodePorts)を使わず、辺だけで判定する: 配置がこの値を使うため、使うと循環する
  const onTop = getNodePorts(doc, node).some((p) => (node.portPlacements?.[p.id]?.side ?? p.side) === 'top');
  return onTop ? TOP_LABEL_SHIFT : 0;
}

/** 左右の辺のポートの開始位置を、番号を出すときに下げる量(アイコン・名前のずれ分も含む) */
/** 番号を出すとき、下辺にポートがあれば、左右の辺の下端を上げる量(下辺の番号の行を避ける) */
export function portFooterExtra(doc: DiagramDocument, node: DiagramNode): number {
  if (!node.showPortLabels) return 0;
  const onBottom = getNodePorts(doc, node).some((p) => (node.portPlacements?.[p.id]?.side ?? p.side) === 'bottom');
  return onBottom ? ceilToGrid(BOTTOM_LABEL_ROW, doc.grid.size) : 0;
}

export function portHeaderExtra(doc: DiagramDocument, node: DiagramNode): number {
  return node.showPortLabels ? SIDE_LABEL_EXTRA + headerShift(doc, node) : 0;
}
