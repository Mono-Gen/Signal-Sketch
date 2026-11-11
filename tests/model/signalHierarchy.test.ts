import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate, setPortGroups } from '../../src/model/actions';
import { planBulkConnect } from '../../src/model/bulkConnect';
import { copySelection, pasteClipboard } from '../../src/model/clipboard';
import { createEmptyDocument } from '../../src/model/defaults';
import { connectionIssues } from '../../src/model/diagnostics';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { addSignalType, moveSignalType, orderedSignalTypes, recreateSignalColor, removeSignalType, reassignAndRemoveSignalType, setSignalParent, signalUsageDetails, updateSignalType } from '../../src/model/signalActions';
import { validateDocument } from '../../src/model/validate';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { DocumentStore } from '../../src/state/store';

const camera = () => presetToTemplate(PRESETS.find((p) => p.id === 'camera')!, 'camera');
const page = 'page-1';

describe('signal hierarchy', () => {
  it('new documents include SERIAL; old documents load without injection', () => {
    const doc = createEmptyDocument();
    expect(doc.signalTypes.find((s) => s.id === 'SERIAL')).toEqual({ id: 'SERIAL', label: 'SERIAL', color: '#d9480f', lineStyle: 'dashed' });
    doc.signalTypes = doc.signalTypes.filter((s) => s.id !== 'SERIAL');
    const loaded = parseDocument(serializeDocument(doc));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.doc.signalTypes.some((s) => s.id === 'SERIAL')).toBe(false);
  });

  it('validates parent references, self-parent and depth', () => {
    const doc = createEmptyDocument();
    const s = doc.signalTypes[0];
    s.parent = 'missing'; expect(validateDocument(doc).ok).toBe(false);
    s.parent = s.id; expect(validateDocument(doc).ok).toBe(false);
    s.parent = 'CONTROL'; doc.signalTypes[1].parent = 'HDMI'; expect(validateDocument(doc).ok).toBe(false);
    delete doc.signalTypes[1].parent; expect(validateDocument(doc).ok).toBe(true);
  });

  it('enforces parent constraints and stores distinct child colors', () => {
    const doc = createEmptyDocument();
    const a = addSignalType('a', '#000000', 'LAN')(doc).created!;
    const b = addSignalType('b', '#000000', 'LAN')(doc).created!;
    const first = doc.signalTypes.find((s) => s.id === a)!;
    const second = doc.signalTypes.find((s) => s.id === b)!;
    expect(first.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(first.color).not.toBe(second.color);
    const color = first.color;
    updateSignalType('LAN', { color: '#000000' })(doc);
    expect(first.color).toBe(color);
    expect(setSignalParent('LAN', 'CONTROL')(doc).error).toBe('invalid-value');
    expect(setSignalParent(a, b)(doc).error).toBe('invalid-value');
    expect(setSignalParent(a, a)(doc).error).toBe('invalid-value');
    expect(setSignalParent(a, null)(doc).ok).toBe(true);
    expect(first.color).toBe(color);
  });

  it('reports usage and reassigns templates and overrides in one undo step', () => {
    const doc = createEmptyDocument();
    const n = addNodeFromTemplate(page, camera(), 'Camera')(doc).created!;
    setPortGroups(page, n, [{ id: 'p', signalType: 'LAN', direction: 'inout', side: 'left', count: 2, labelPrefix: '' }])(doc);
    const usage = signalUsageDetails(doc, 'LAN');
    expect(usage.ports).toBe(2);
    expect(usage.devices).toEqual([{ name: 'Camera', count: 2 }]);
    expect(usage.templates).toEqual([camera().name]);
    const store = new DocumentStore(doc);
    expect(store.apply(reassignAndRemoveSignalType('LAN', 'USB')).ok).toBe(true);
    expect(store.doc.deviceTemplates[0].portGroups.some((g) => g.signalType === 'LAN')).toBe(false);
    expect(store.doc.pages[0].nodes[0].portGroupsOverride![0].signalType).toBe('USB');
    expect(store.undo()).toBe(true);
    expect(store.doc).toEqual(doc);
  });

  it('uses the specified deletion error precedence', () => {
    const doc = createEmptyDocument();
    const child = addSignalType('a', '#123456', 'LAN')(doc).created!;
    expect(reassignAndRemoveSignalType('LAN', 'LAN')(doc).error).toBe('unknown-signal');
    expect(reassignAndRemoveSignalType('LAN', 'missing')(doc).error).toBe('unknown-signal');
    expect(reassignAndRemoveSignalType('LAN', child)(doc).error).toBe('invalid-value');
    expect(reassignAndRemoveSignalType('LAN', 'USB')(doc).error).toBe('signal-in-use');
    expect(removeSignalType('LAN')(doc).error).toBe('signal-in-use');
  });

  it('compares roots in diagnostics and bulk connections', () => {
    const doc = createEmptyDocument();
    const a = addSignalType('a', '#123456', 'LAN')(doc).created!;
    const b = addSignalType('b', '#123456', 'LAN')(doc).created!;
    const port = (signalType: string) => ({ signalType, direction: 'inout' as const, multi: false });
    expect(connectionIssues(port(a), port('LAN'), doc.signalTypes)).toEqual([]);
    expect(connectionIssues(port(a), port(b), doc.signalTypes)).toEqual([]);
    expect(connectionIssues(port(a), port('USB'), doc.signalTypes)).toContain('signal-mismatch');
    const n1 = addNodeFromTemplate(page, camera(), 'one', { x: 20, y: 20 })(doc).created!;
    const n2 = addNodeFromTemplate(page, camera(), 'two', { x: 400, y: 20 })(doc).created!;
    const groups = (id: string) => [{ id: 'p', signalType: id, direction: 'inout' as const, side: 'left' as const, count: 1, labelPrefix: '' }];
    setPortGroups(page, n1, groups(a))(doc); setPortGroups(page, n2, groups(b))(doc);
    const run = () => planBulkConnect(doc, page, [{ nodeId: n1, portId: 'p-1' }], { nodeId: n2, portId: 'p-1' });
    expect(run().pairs).toHaveLength(1);
    setPortGroups(page, n2, groups('LAN'))(doc); expect(run().pairs).toHaveLength(1);
    setPortGroups(page, n2, groups('USB'))(doc); expect(run().skipped[0].reason).toBe('signal-mismatch');
  });

  it('copies the parent of a referenced child signal', () => {
    const doc = createEmptyDocument();
    const child = addSignalType('child', '#123456', 'LAN')(doc).created!;
    const n = addNodeFromTemplate(page, camera(), 'one')(doc).created!;
    setPortGroups(page, n, [{ id: 'p', signalType: child, direction: 'inout', side: 'left', count: 1, labelPrefix: '' }])(doc);
    const copied = copySelection(doc, page, { nodeIds: [n] })!;
    expect(copied.signalTypes.map((s) => s.id)).toContain('LAN');
    const dest = createEmptyDocument(); dest.signalTypes = [];
    expect(pasteClipboard(page, copied, { dx: 0, dy: 0 })(dest).ok).toBe(true);
    expect(validateDocument(dest).ok).toBe(true);
  });
});

describe('hierarchy regression cases', () => {
  it('protects zero-count override references and reassigns them', () => {
    const doc = createEmptyDocument();
    const n = addNodeFromTemplate(page, camera(), 'Camera')(doc).created!;
    expect(setPortGroups(page, n, [{ id: 'zero', signalType: 'USB', direction: 'inout', side: 'left', count: 0, labelPrefix: '' }])(doc).ok).toBe(true);
    expect(signalUsageDetails(doc, 'USB')).toMatchObject({ ports: 0, devices: [{ name: 'Camera', count: 0 }], templates: [] });
    expect(removeSignalType('USB')(doc).error).toBe('signal-in-use');
    expect(reassignAndRemoveSignalType('USB', 'LAN')(doc).ok).toBe(true);
    expect(doc.pages[0].nodes[0].portGroupsOverride![0].signalType).toBe('LAN');
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('moves roots and children only among their peers in displayed order', () => {
    const doc = createEmptyDocument();
    doc.signalTypes = [
      { id: 'r1', label: 'r1', color: '#123456' },
      { id: 'a', label: 'a', color: '#123456', parent: 'r1' },
      { id: 'r2', label: 'r2', color: '#123456' },
      { id: 'c', label: 'c', color: '#123456', parent: 'r2' },
      { id: 'b', label: 'b', color: '#123456', parent: 'r1' },
    ];
    const order = () => orderedSignalTypes(doc.signalTypes).map((s) => s.id);
    expect(order()).toEqual(['r1', 'a', 'b', 'r2', 'c']);
    moveSignalType('a', 1)(doc);
    expect(order()).toEqual(['r1', 'b', 'a', 'r2', 'c']);
    moveSignalType('a', 1)(doc);
    expect(order()).toEqual(['r1', 'b', 'a', 'r2', 'c']);
    moveSignalType('r2', -1)(doc);
    expect(order()).toEqual(['r2', 'c', 'r1', 'b', 'a']);
  });

  it('recreates child color without matching another sibling', () => {
    const doc = createEmptyDocument();
    const a = addSignalType('a', '#123456', 'LAN')(doc).created!;
    const b = addSignalType('b', '#123456', 'LAN')(doc).created!;
    const aSignal = doc.signalTypes.find((s) => s.id === a)!;
    const bSignal = doc.signalTypes.find((s) => s.id === b)!;
    aSignal.color = '#ffffff';
    expect(recreateSignalColor(a)(doc).ok).toBe(true);
    expect(aSignal.color).not.toBe(bSignal.color);
    const first = aSignal.color;
    expect(recreateSignalColor(a)(doc).ok).toBe(true);
    expect(aSignal.color).toBe(first);
  });

  it('remaps conflicting root and child IDs through templates and overrides', () => {
    const source = createEmptyDocument();
    const child = addSignalType('child', '#123456', 'LAN')(source).created!;
    const n = addNodeFromTemplate(page, camera(), 'source')(source).created!;
    source.deviceTemplates[0].portGroups[0].signalType = child;
    source.pages[0].nodes[0].portGroupsOverride = [{ id: 'z', signalType: child, direction: 'inout', side: 'left', count: 1, labelPrefix: '' }];
    const data = copySelection(source, page, { nodeIds: [n] })!;
    const destination = createEmptyDocument();
    destination.signalTypes.find((s) => s.id === 'LAN')!.parent = 'CONTROL';
    destination.signalTypes.push({ id: child, label: 'child', color: '#112233', parent: 'CONTROL' });
    const result = pasteClipboard(page, data, { dx: 0, dy: 0 })(destination);
    expect(result.ok).toBe(true);
    const pasted = destination.pages[0].nodes[0];
    const importedChildId = pasted.portGroupsOverride![0].signalType;
    expect(importedChildId).not.toBe(child);
    const importedChild = destination.signalTypes.find((s) => s.id === importedChildId)!;
    expect(importedChild.parent).not.toBe('LAN');
    expect(destination.signalTypes.find((s) => s.id === importedChild.parent)).toMatchObject({ label: 'LAN' });
    expect(destination.deviceTemplates.find((t) => t.id === pasted.templateId)!.portGroups[0].signalType).toBe(importedChildId);
    expect(destination.signalTypes.find((s) => s.id === 'LAN')!.parent).toBe('CONTROL');
    expect(validateDocument(destination).ok).toBe(true);
  });

  it('reuses equivalent signal IDs and root structure', () => {
    const source = createEmptyDocument();
    const child = addSignalType('child', '#123456', 'LAN')(source).created!;
    const n = addNodeFromTemplate(page, camera(), 'source')(source).created!;
    source.pages[0].nodes[0].portGroupsOverride = [{ id: 'z', signalType: child, direction: 'inout', side: 'left', count: 1, labelPrefix: '' }];
    const data = copySelection(source, page, { nodeIds: [n] })!;
    const destination = createEmptyDocument();
    destination.signalTypes.push({ id: child, label: 'child', color: '#ffffff', parent: 'LAN' });
    const count = destination.signalTypes.length;
    expect(pasteClipboard(page, data, { dx: 0, dy: 0 })(destination).ok).toBe(true);
    expect(destination.signalTypes).toHaveLength(count);
    expect(destination.pages[0].nodes[0].portGroupsOverride![0].signalType).toBe(child);
  });
});
