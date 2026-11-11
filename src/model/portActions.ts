import type { Action } from './actions';
import { getNodePorts, getPage, getTemplate } from './query';
import type { DiagramDocument } from './types';

function affected(doc: DiagramDocument, pageId: string, nodeId: string, ids: readonly string[]): Set<string> {
  const node = getPage(doc, pageId)?.nodes.find((n) => n.id === nodeId);
  if (!node) return new Set();
  const ports = getNodePorts(doc, node);
  const chosen = ports.filter((p) => ids.includes(p.id));
  return new Set(ports.filter((p) => chosen.some((c) => c.groupId === p.groupId && c.index === p.index)).map((p) => p.id));
}

export function countRemovedPortEdges(doc: DiagramDocument, pageId: string, nodeId: string, ids: readonly string[]): number {
  const removed = affected(doc, pageId, nodeId, ids);
  return (getPage(doc, pageId)?.edges ?? []).filter((e) => (e.from.nodeId === nodeId && removed.has(e.from.portId)) || (e.to.nodeId === nodeId && removed.has(e.to.portId))).length;
}

export function removePorts(pageId: string, nodeId: string, ids: readonly string[]): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return { ok: false, error: 'unknown-page' };
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, error: 'unknown-node' };
    const template = getTemplate(doc, node.templateId);
    if (!template) return { ok: false, error: 'unknown-template' };
    const ports = getNodePorts(doc, node);
    const selected = ids.map((id) => ports.find((p) => p.id === id));
    if (selected.some((p) => !p)) return { ok: false, error: 'unknown-port' };
    const removed = affected(doc, pageId, nodeId, ids);
    const groups = structuredClone(node.portGroupsOverride ?? template.portGroups);
    // The group definition is shared across units, so an index disappears from every unit.
    for (const group of groups) {
      const indices = selected.filter((p) => p!.groupId === group.id).map((p) => p!.index);
      if (indices.length) group.skipped = [...new Set([...(group.skipped ?? []), ...indices])].sort((a, b) => a - b);
    }
    node.portGroupsOverride = groups;
    page.edges = page.edges.filter((e) => !(e.from.nodeId === nodeId && removed.has(e.from.portId)) && !(e.to.nodeId === nodeId && removed.has(e.to.portId)));
    if (node.portPlacements) {
      for (const id of removed) delete node.portPlacements[id];
      if (!Object.keys(node.portPlacements).length) delete node.portPlacements;
    }
    return { ok: true };
  };
}

export function restorePorts(pageId: string, nodeId: string, groupId: string, indices: readonly number[]): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return { ok: false, error: 'unknown-page' };
    const node = page.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, error: 'unknown-node' };
    const template = getTemplate(doc, node.templateId);
    if (!template) return { ok: false, error: 'unknown-template' };
    const groups = structuredClone(node.portGroupsOverride ?? template.portGroups);
    const group = groups.find((g) => g.id === groupId);
    if (!group || indices.some((n) => !group.skipped?.includes(n))) return { ok: false, error: 'unknown-port' };
    const remaining = (group.skipped ?? []).filter((n) => !indices.includes(n));
    if (remaining.length) group.skipped = remaining; else delete group.skipped;
    node.portGroupsOverride = groups;
    return { ok: true };
  };
}
