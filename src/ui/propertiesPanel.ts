import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Diagnostic } from '../model/diagnostics';
import { MIN_DISTRIBUTE_COUNT, planAlign, planDistribute } from '../model/align';
import type { AlignMode, DistributeAxis } from '../model/align';
import { nodesInFrame, updateFrame } from '../model/frames';
import { clearPortPlacements, lostEdgeIds, lostEdgeIdsForCount, setPageSize, setPortGroups, updateNode } from '../model/actions';
import type { Action, ActionResult } from '../model/actions';
import { uniqueId } from '../model/ids';
import { PAGE_SIZE_PRESETS, presetIndexOf } from '../model/pageSize';
import { getNodePorts, getPage, getTemplate } from '../model/query';
import { resolvePortGroups } from '../model/ports';
import { addSignalType, moveSignalType, removeSignalType, signalUsage, updateSignalType } from '../model/signalActions';
import type { Direction, DiagramDocument, DiagramNode, PortGroup, Side } from '../model/types';
import { prepareImage } from '../io/imageImport';
import { clearNodesImage, resizeNode, setNodesImage } from '../model/imageActions';
import { registerTemplate } from '../model/templateActions';
import { resizeNodes, setPortGroupsMany, updateNodes } from '../model/bulkActions';
import { applyAlignPlan } from './alignCommands';
import { el, field, select } from './dom';
import { askRegistrationName } from './registerDeviceDialog';

export interface PanelContext {
  getDoc(): DiagramDocument;
  pageId: string;
  /** 操作を適用する。失敗時の表示は呼び出し側が行い、結果だけ返す */
  apply(action: Action): ActionResult;
  confirm(message: string): boolean;
  /** 現在の確認事項(図から計算したもの) */
  getDiagnostics(): Diagnostic[];
  /** 確認事項の項目から、該当の接続を選択する */
  selectEdge(edgeId: string): void;
  /** 図が丸ごと入れ替わった(新規・読込)回数。画像の取り込みのような時間のかかる処理が、始めた図のままかの確認に使う */
  getEpoch(): number;
  /** 操作の結果を状態表示へ出す */
  setStatus(kind: 'info' | 'ok' | 'warn' | 'error', text: string): void;
}

/** 揃えのボタン(表示順)。表示名は i18n の align.<mode> */
const ALIGN_MODES: AlignMode[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
const DISTRIBUTE_AXES: DistributeAxis[] = ['horizontal', 'vertical'];

/** 追加する信号の色の候補(標準の色と見分けやすい順)。ユーザーは色ピッカーで自由に変えられる */
const NEW_SIGNAL_COLORS = ['#e8590c', '#0c8599', '#5f3dc4', '#862e9c', '#2b8a3e', '#364fc7'];

const SIDES: Side[] = ['left', 'right', 'top', 'bottom'];
const DIRECTIONS: Direction[] = ['in', 'out', 'inout'];

/**
 * 選択中の機器の名称・型番・台数と、ポート構成を編集する。
 * ポート構成は「この機器だけ」の上書きとして保存する(同じ種類の他の機器は変わらない)。
 * 値は入力欄を離れたとき(change)に確定し、キー入力のたびには適用しない。
 */
export class PropertiesPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: PanelContext,
  ) {
    // Tab で次の欄へ移るとき、change は focusout より先に、しかも activeElement が body になった状態で
    // 起きる(実ブラウザの記録で確認)。そのため「いまフォーカスがあるか」では判定できない。
    // パネル内で change が起きたこと自体を覚えておき、その処理の間の描き直しを遅らせる。
    root.addEventListener(
      'change',
      () => {
        this.committing = true;
        setTimeout(() => (this.committing = false), 0);
      },
      true,
    );
  }

  private pendingRender: (() => void) | undefined;
  /** パネル内で値の確定(change)が起きた直後の、同じ処理の間か */
  private committing = false;

  /** パネルの識別子を、フォーカス復元用の文字列にする(機器・信号の行、項目名、ボタン名の組) */
  private focusKey(target: Element | null): string | undefined {
    if (!(target instanceof HTMLElement) || !this.root.contains(target)) return undefined;
    const part = (attr: string): string => target.closest(`[${attr}]`)?.getAttribute(attr) ?? '';
    const key = [part('data-group'), part('data-signal'), target.dataset.prop ?? '', target.dataset.action ?? ''].join('|');
    return key === '|||' ? undefined : key;
  }

  /**
   * パネルを描き直す。入力欄にフォーカスがあるときは、描き直しを一呼吸遅らせる:
   * 値の確定(change)は、Tab で次の欄へ移る途中に起きる。その場で作り直すと、移動先の欄ごと消えて
   * フォーカスを失う。遅らせて、移動が終わったあとの欄を覚え、作り直した同じ欄へフォーカスを戻す。
   */
  private refresh(render: () => void): void {
    if (this.focusKey(document.activeElement) === undefined && !this.committing) {
      render(); // フォーカスが無く、値の確定の途中でもないときは、すぐ描き直す
      return;
    }
    const first = this.pendingRender === undefined;
    this.pendingRender = render; // 続けて来た要求は、最後の1回にまとめる
    if (!first) return;
    setTimeout(() => {
      const run = this.pendingRender;
      this.pendingRender = undefined;
      if (!run) return;
      const key = this.focusKey(document.activeElement);
      run();
      if (key === undefined) return;
      for (const candidate of this.root.querySelectorAll<HTMLElement>('[data-prop], [data-action]')) {
        if (this.focusKey(candidate) === key) {
          candidate.focus();
          return;
        }
      }
    }, 0);
  }

  update(nodeId: string | null): void {
    this.refresh(() => this.renderNode(nodeId));
  }

  /**
   * 2件以上を選んでいるとき: 編集欄は出さず、件数と削除の案内を出す(確認事項などは残す)。
   * 機器を2台以上選んでいれば、揃え・等間隔のボタンも出す(枠や線は対象外)。
   */
  updateMulti(count: number, nodeIds: readonly string[] = []): void {
    this.refresh(() => this.renderNode(null, t('props.multi', { count }), nodeIds));
  }

  private renderNode(nodeId: string | null, emptyHint: string = t('props.empty'), alignIds: readonly string[] = []): void {
    this.root.replaceChildren(el('h2', { text: t('props.title') }));
    const doc = this.ctx.getDoc();
    const node = nodeId ? getPage(doc, this.ctx.pageId)?.nodes.find((n) => n.id === nodeId) : undefined;
    if (!node) {
      this.root.append(el('p', { className: 'hint', text: emptyHint }));
      if (alignIds.length >= 2) this.root.append(this.bulkFields(alignIds), this.bulkPortSection(doc, alignIds), this.alignSection(alignIds), this.imageSection(alignIds));
      this.root.append(this.checksSection(doc), this.pageSizeSection(doc), this.legendSection(doc));
      return;
    }
    this.root.append(this.basicFields(node), this.portSection(doc, [node]));
  }

  /**
   * 複数の機器をまとめて変える欄(名称・型番・台数・幅・高さ)。全員の値が同じならその値を、違えば空欄(「複数の値」)を出し、
   * 利用者が入力した項目だけを全員に反映する。種類が違う機器どうしでも共通で持つ項目だけを対象にする。
   */
  private bulkFields(ids: readonly string[]): HTMLElement {
    const doc = this.ctx.getDoc();
    const nodes = (getPage(doc, this.ctx.pageId)?.nodes ?? []).filter((n) => ids.includes(n.id));
    const common = (pick: (n: DiagramNode) => string): string => {
      const values = new Set(nodes.map(pick));
      return values.size === 1 ? [...values][0] : '';
    };
    const mixed = (pick: (n: DiagramNode) => string): boolean => new Set(nodes.map(pick)).size > 1;
    const refill = () => this.updateMulti(ids.length, ids);
    const input = (dataProp: string, pick: (n: DiagramNode) => string, type: 'text' | 'number', onChange: (raw: string) => void, extra: Record<string, string> = {}) =>
      el('input', {
        attrs: { type, value: common(pick), 'data-prop': dataProp, ...(mixed(pick) ? { placeholder: t('props.mixed') } : {}), ...extra },
        on: { change: (ev) => onChange((ev.target as HTMLInputElement).value) },
      });
    const step = doc.grid.enabled ? String(doc.grid.size) : '1';
    const size = (prop: 'w' | 'h') => (raw: string) => {
      if (raw.trim() !== '') this.ctx.apply(resizeNodes(this.ctx.pageId, ids, { [prop]: Number(raw) }));
      refill(); // 不正な値は元へ戻し、丸めや最小への補正は欄へ反映する
    };
    const text = (prop: 'label' | 'model') => (raw: string) => {
      const r = this.ctx.apply(updateNodes(this.ctx.pageId, ids, { [prop]: raw }));
      if (!r.ok) refill();
    };
    const count = (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        refill(); // 空は「変更しない」(台数表記を消す操作は、1台ずつ選んで行う)
        return;
      }
      const next = Number(trimmed);
      const lost = Number.isInteger(next) && next >= 1 ? [...new Set(ids.flatMap((id) => lostEdgeIdsForCount(this.ctx.getDoc(), this.ctx.pageId, id, next)))] : [];
      if (lost.length > 0 && !this.ctx.confirm(t('confirm.removePorts', { count: lost.length }))) {
        refill();
        return;
      }
      const r = this.ctx.apply(updateNodes(this.ctx.pageId, ids, { count: next }, { removeOrphanEdges: lost.length > 0 }));
      if (!r.ok) refill();
    };
    return el('div', { className: 'section', attrs: { 'data-section': 'bulk' } }, [
      el('h3', { text: t('props.bulkTitle') }),
      el('p', { className: 'hint', text: t('props.bulkHint') }),
      field(t('props.name'), input('bulk-label', (n) => n.label, 'text', text('label'))),
      field(t('props.model'), input('bulk-model', (n) => n.model, 'text', text('model'))),
      field(t('props.count'), input('bulk-count', (n) => (n.count ? String(n.count) : ''), 'number', count, { min: '1', step: '1' })),
      el('div', { className: 'size-row' }, [
        field(t('props.width'), input('bulk-width', (n) => String(Math.round(n.w)), 'number', size('w'), { min: '1', step })),
        field(t('props.height'), input('bulk-height', (n) => String(Math.round(n.h)), 'number', size('h'), { min: '1', step })),
      ]),
    ]);
  }

  /** 選んだ機器の揃え・等間隔。動く機器がなければ何も適用せず(履歴を積まず)、その旨を知らせる */
  private alignSection(ids: readonly string[]): HTMLElement {
    const run = (moves: ReturnType<typeof planAlign>): void => applyAlignPlan(moves, this.ctx);
    const button = (text: string, action: string, disabled: boolean, onClick: () => void) =>
      el('button', {
        text,
        attrs: { type: 'button', 'data-action': action, ...(disabled ? { disabled: '', title: t('align.needThree') } : {}) },
        on: { click: onClick },
      });
    const doc = () => this.ctx.getDoc();
    const canDistribute = ids.length >= MIN_DISTRIBUTE_COUNT;
    return el('div', { className: 'section', attrs: { 'data-section': 'align' } }, [
      el('h3', { text: t('align.title') }),
      el(
        'div',
        { className: 'button-row' },
        ALIGN_MODES.map((mode) => button(t(('align.' + mode) as MessageKey), 'align-' + mode, false, () => run(planAlign(doc(), this.ctx.pageId, ids, mode)))),
      ),
      el(
        'div',
        { className: 'button-row' },
        DISTRIBUTE_AXES.map((axis) =>
          button(t(('align.distribute.' + axis) as MessageKey), 'distribute-' + axis, !canDistribute, () => run(planDistribute(doc(), this.ctx.pageId, ids, axis))),
        ),
      ),
      // 無効の理由は title だけでは、キーボードや読み上げでは分からないので、文でも出す
      ...(canDistribute ? [] : [el('p', { className: 'hint', text: t('align.needThree') })]),
    ]);
  }

  /**
   * 確認事項の一覧。図から計算した指摘を並べ、項目を押すと該当の線を選択する。
   * 直した指摘は、次の描き直しで一覧から消える(保存しない、毎回計算する)。
   */
  private checksSection(doc: DiagramDocument): HTMLElement {
    const items = this.ctx.getDiagnostics();
    const section = el('div', { className: 'section', attrs: { 'data-section': 'checks' } }, [
      el('h3', { text: t('check.title') + (items.length > 0 ? ` (${items.length})` : '') }),
    ]);
    if (items.length === 0) {
      section.append(el('p', { className: 'hint', text: '✓ ' + t('check.none') }));
      return section;
    }
    section.append(el('p', { className: 'hint', text: t('check.legend') }));
    const page = getPage(doc, this.ctx.pageId);
    const where = (ref: { nodeId: string; portId: string }) => {
      const node = page?.nodes.find((n) => n.id === ref.nodeId);
      const port = node ? getNodePorts(doc, node).find((p) => p.id === ref.portId) : undefined;
      return `${node?.label ?? ref.nodeId} ${port?.label ?? ref.portId}`;
    };
    const signalLabel = (ref: { nodeId: string; portId: string }) => {
      const node = page?.nodes.find((n) => n.id === ref.nodeId);
      const sig = node ? getNodePorts(doc, node).find((p) => p.id === ref.portId)?.signalType : undefined;
      return doc.signalTypes.find((s) => s.id === sig)?.label ?? sig ?? '?';
    };
    for (const d of items) {
      const message =
        d.code === 'signal-mismatch'
          ? t('check.signalMismatch', { a: signalLabel(d.from), b: signalLabel(d.to) })
          : d.code === 'direction-mismatch'
            ? t('check.directionMismatch')
            : t('check.broken');
      const icon = d.severity === 'error' ? '✕' : '⚠';
      section.append(
        el('button', {
          className: `check-item ${d.severity}`,
          attrs: { type: 'button', 'data-check': d.key },
          on: { click: () => this.ctx.selectEdge(d.edgeId) },
        }, [
          el('span', { className: 'check-head', text: `${icon} ${where(d.from)} ↔ ${where(d.to)}` }),
          el('span', { className: 'check-msg', text: message }),
        ]),
      );
    }
    return section;
  }

  /** 凡例(信号の種類)の編集。何も選んでいないときに出す。名称・色・並び・追加・削除 */
  /** 「自由に指定」を選んだ状態(表示だけの状態で、保存しない)。標準以外の大きさのときは常に入力欄を出す */
  private customSize = false;

  /**
   * ページ(キャンバス)の大きさ。標準は 16:9 の3段階、「自由に指定」で幅・高さを数値で入力する。
   * 小さくして機器・枠がはみ出す場合は、操作が断られ(理由は右上に表示)、欄は元の値へ戻る。
   */
  private pageSizeSection(doc: DiagramDocument): HTMLElement {
    const page = getPage(doc, this.ctx.pageId);
    const section = el('div', { className: 'section' }, [el('h3', { text: t('page.title') })]);
    if (!page) return section;
    const size = page.size;
    const preset = presetIndexOf(size);
    const showInputs = this.customSize || preset === -1;
    const options = [...PAGE_SIZE_PRESETS.map((p, i) => ({ value: String(i), label: `${p.w} × ${p.h}` })), { value: 'custom', label: t('page.custom') }];
    const sel = select(options, showInputs ? 'custom' : String(preset));
    sel.setAttribute('data-prop', 'page-preset');
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') {
        this.customSize = true;
        this.update(null);
        return;
      }
      this.customSize = false;
      const p = PAGE_SIZE_PRESETS[Number(sel.value)];
      if (!this.ctx.apply(setPageSize(this.ctx.pageId, p)).ok) this.update(null); // 断られたら、選択を元へ戻す
    });
    section.append(field(t('page.size'), sel));
    if (showInputs) {
      const num = (prop: 'w' | 'h', label: string) => {
        const input = el('input', {
          attrs: { type: 'number', step: String(doc.grid.size), value: String(size[prop]), 'data-prop': `page-${prop}` },
          on: {
            change: (ev) => {
              const v = Number((ev.target as HTMLInputElement).value);
              if (!this.ctx.apply(setPageSize(this.ctx.pageId, { ...size, [prop]: v })).ok) this.update(null); // 不正・断られた値は元へ戻す
            },
          },
        });
        return field(label, input);
      };
      section.append(num('w', t('page.width')), num('h', t('page.height')));
    }
    section.append(el('p', { className: 'hint', text: t('page.hint') }));
    return section;
  }

  private legendSection(doc: DiagramDocument): HTMLElement {
    const section = el('div', { className: 'section' }, [el('h3', { text: t('legend.edit') })]);
    const last = doc.signalTypes.length - 1;
    doc.signalTypes.forEach((s, i) => {
      const used = signalUsage(doc, s.id);
      const color = el('input', {
        className: 'color-input',
        attrs: { type: 'color', value: s.color, 'aria-label': t('legend.colorLabel'), 'data-prop': 'signal-color' },
        on: { change: (ev) => this.ctx.apply(updateSignalType(s.id, { color: (ev.target as HTMLInputElement).value })) },
      });
      const label = el('input', {
        attrs: { type: 'text', value: s.label, 'data-prop': 'signal-label' },
        on: {
          change: (ev) => {
            const r = this.ctx.apply(updateSignalType(s.id, { label: (ev.target as HTMLInputElement).value }));
            if (!r.ok) this.update(null); // 空の名称などは拒否し、入力欄を元の値へ戻す
          },
        },
      });
      const button = (text: string, aria: string, action: string, disabled: boolean, onClick: () => void) =>
        el('button', { text, attrs: { type: 'button', 'aria-label': aria, 'data-action': action, ...(disabled ? { disabled: '' } : {}) }, on: { click: onClick } });
      const row = el('div', { className: 'signal-row', attrs: { 'data-signal': s.id } }, [
        color,
        label,
        button(t('legend.up'), t('legend.upLabel'), 'signal-up', i === 0, () => this.ctx.apply(moveSignalType(s.id, -1))),
        button(t('legend.down'), t('legend.downLabel'), 'signal-down', i === last, () => this.ctx.apply(moveSignalType(s.id, 1))),
        button(t('legend.remove'), t('legend.remove'), 'signal-remove', false, () => this.ctx.apply(removeSignalType(s.id))),
      ]);
      if (used > 0) row.title = t('legend.usage', { count: used });
      section.append(row);
    });
    section.append(
      el('button', {
        text: t('legend.add'),
        attrs: { type: 'button', 'data-action': 'signal-add' },
        on: { click: () => this.ctx.apply(addSignalType(t('legend.newLabel'), NEW_SIGNAL_COLORS[doc.signalTypes.length % NEW_SIGNAL_COLORS.length])) },
      }),
    );
    return section;
  }

  /** 選択した枠の編集。名称と、中にある機器の数。枠の位置・大きさは、図の上で直接変える */
  updateFrame(frameId: string): void {
    this.refresh(() => this.renderFrame(frameId));
  }

  private renderFrame(frameId: string): void {
    this.root.replaceChildren(el('h2', { text: t('frame.title') }));
    const doc = this.ctx.getDoc();
    const page = getPage(doc, this.ctx.pageId);
    const frame = page?.groups.find((g) => g.id === frameId);
    if (!page || !frame) {
      this.renderNode(null);
      return;
    }
    const name = el('input', {
      attrs: { type: 'text', value: frame.label, 'data-prop': 'frame-label' },
      on: { change: (ev) => this.ctx.apply(updateFrame(this.ctx.pageId, frameId, { label: (ev.target as HTMLInputElement).value })) },
    });
    this.root.append(
      el('div', { className: 'section' }, [
        field(t('props.name'), name),
        el('p', { className: 'hint', text: t('frame.contains', { count: nodesInFrame(page, frame).length }) }),
        el('p', { className: 'hint', text: t('frame.hint') }),
      ]),
    );
  }

  private basicFields(node: DiagramNode): HTMLElement {
    const text = (value: string, onChange: (v: string) => void, attrs: Record<string, string> = {}) =>
      el('input', { attrs: { type: 'text', value, ...attrs }, on: { change: (ev) => onChange((ev.target as HTMLInputElement).value) } });

    const name = text(node.label, (v) => this.ctx.apply(updateNode(this.ctx.pageId, node.id, { label: v })));
    name.setAttribute('data-prop', 'label');
    const model = text(node.model, (v) => this.ctx.apply(updateNode(this.ctx.pageId, node.id, { model: v })));
    model.setAttribute('data-prop', 'model');
    const count = el('input', {
      attrs: { type: 'number', min: '1', step: '1', value: node.count ? String(node.count) : '', 'data-prop': 'count' },
      on: {
        change: (ev) => {
          const raw = (ev.target as HTMLInputElement).value.trim();
          const next = raw === '' ? undefined : Number(raw);
          // 台数を減らすと、なくなる台のポートの接続も消える。確認を取ってから適用する
          const lost = next === undefined || (Number.isInteger(next) && next >= 1) ? lostEdgeIdsForCount(this.ctx.getDoc(), this.ctx.pageId, node.id, next ?? 1) : [];
          if (lost.length > 0 && !this.ctx.confirm(t('confirm.removePorts', { count: lost.length }))) {
            this.update(node.id);
            return;
          }
          const r = this.ctx.apply(updateNode(this.ctx.pageId, node.id, { count: next }, { removeOrphanEdges: lost.length > 0 }));
          if (!r.ok) this.update(node.id); // 不正な値は、入力欄を元の値へ戻す
        },
      },
    });
    return el('div', { className: 'section' }, [
      field(t('props.name'), name),
      field(t('props.model'), model),
      field(t('props.count'), count),
      ...(node.count && node.count > 1 ? [el('p', { className: 'hint', text: t('props.unitPortsHint') })] : []),
      this.sizeFields(node),
      this.imageSection([node.id], true),
    ]);
  }

  /** 機器の幅・高さ。グリッドの倍数へ丸められ、ポートと文字が収まる最小より小さくはならない(結果は入力欄へ戻す) */
  private sizeFields(node: DiagramNode): HTMLElement {
    const doc = this.ctx.getDoc();
    const step = doc.grid.enabled ? String(doc.grid.size) : '1';
    const input = (prop: 'w' | 'h', dataProp: string) =>
      el('input', {
        attrs: { type: 'number', min: '1', step, value: String(Math.round(node[prop])), 'data-prop': dataProp },
        on: {
          change: (ev) => {
            const raw = (ev.target as HTMLInputElement).value.trim();
            const size = { w: node.w, h: node.h, [prop]: Number(raw) };
            if (raw !== '') this.ctx.apply(resizeNode(this.ctx.pageId, node.id, size));
            this.update(node.id); // 不正な値は元の値へ戻し、丸めや最小への補正は入力欄へ反映する
          },
        },
      });
    return el('div', { className: 'size-row' }, [field(t('props.width'), input('w', 'width')), field(t('props.height'), input('h', 'height'))]);
  }

  /**
   * 機器の画像。ファイルを選ぶと、縮小・再符号化して図に入れる。外すと、小さなアイコンに戻る。
   * 複数の機器を選んでいるときは、選んだ機器すべてに(縮小・再符号化は1回だけ行い、同じ画像を共有する)。
   */
  private imageSection(nodeIds: readonly string[], allowRegistration = false): HTMLElement {
    const page = getPage(this.ctx.getDoc(), this.ctx.pageId);
    const anyImage = nodeIds.some((id) => page?.nodes.find((n) => n.id === id)?.imageId);
    const file = el('input', {
      attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'data-prop': 'image-file', hidden: '', tabindex: '-1' },
      on: {
        change: (ev) => {
          const input = ev.target as HTMLInputElement;
          const picked = input.files?.[0];
          input.value = ''; // 同じファイルを続けて選んでも change が発火するよう、空に戻す
          if (picked) void this.setImage(nodeIds, picked);
        },
      },
    });
    const choose = el('button', { text: t('props.imageChoose'), attrs: { type: 'button', 'data-action': 'image-choose' }, on: { click: () => file.click() } });
    const remove = el('button', {
      text: t('props.imageRemove'),
      attrs: { type: 'button', 'data-action': 'image-remove', ...(anyImage ? {} : { disabled: '' }) },
      on: {
        click: () => {
          if (this.ctx.apply(clearNodesImage(this.ctx.pageId, nodeIds)).ok) this.ctx.setStatus('ok', t('status.imageRemoved'));
        },
      },
    });
    const register = allowRegistration
      ? el('button', {
          text: t('props.registerDevice'),
          attrs: { type: 'button', 'data-action': 'register-device' },
          on: { click: () => void this.registerDevice(nodeIds[0]) },
        })
      : undefined;
    return el('div', { className: 'section', attrs: { 'data-section': 'image' } }, [
      el('h3', { text: t('props.image') }),
      el('div', { className: 'button-row' }, [choose, remove, file, ...(register ? [register] : [])]),
      el('p', { className: 'hint', text: t('props.imageHint') }),
    ]);
  }

  /** 名前を確認して、選択中の1台を「この図の機器」へ登録する */
  private async registerDevice(nodeId: string): Promise<void> {
    const node = getPage(this.ctx.getDoc(), this.ctx.pageId)?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const name = await askRegistrationName(node.label);
    if (!name) return;
    if (this.ctx.apply(registerTemplate(this.ctx.pageId, nodeId, name)).ok) {
      this.ctx.setStatus('ok', t('status.deviceRegistered'));
    }
  }

  /** いちばん新しい画像の取り込みの番号。古い取り込みが、あとから完了しても、結果を捨てるために使う */
  private imageRequest = 0;

  private async setImage(nodeIds: readonly string[], file: File): Promise<void> {
    const request = ++this.imageRequest;
    const epoch = this.ctx.getEpoch();
    const prepared = await prepareImage(file);
    // 取り込みの間に、新しい取り込みを始めた・図が入れ替わった(新規・開く)ときは、この結果は使わない(別の図の同じIDの機器に付けないため)
    if (request !== this.imageRequest || epoch !== this.ctx.getEpoch()) return;
    if (!prepared.ok) {
      this.ctx.setStatus('error', t(`error.image.${prepared.error}` as MessageKey));
      return;
    }
    if (this.ctx.apply(setNodesImage(this.ctx.pageId, nodeIds, prepared.image)).ok) {
      this.ctx.setStatus('ok', nodeIds.length > 1 ? t('status.imageSetMany', { count: nodeIds.length }) : t('status.imageSet'));
    }
  }

  /** 複数の機器のポート構成。全員の構成が同じときだけ編集欄を出す(違うと、どれを基準にするか決まらない) */
  private bulkPortSection(doc: DiagramDocument, ids: readonly string[]): HTMLElement {
    const nodes = (getPage(doc, this.ctx.pageId)?.nodes ?? []).filter((n) => ids.includes(n.id));
    const layoutOf = (n: DiagramNode): string => {
      const tpl = getTemplate(doc, n.templateId);
      return JSON.stringify(tpl ? resolvePortGroups(tpl, n) : []);
    };
    if (nodes.length < 2 || new Set(nodes.map(layoutOf)).size > 1) {
      return el('div', { className: 'section', attrs: { 'data-section': 'bulk-ports' } }, [
        el('h3', { text: t('props.ports') }),
        el('p', { className: 'hint', text: t('props.portsMixed') }),
      ]);
    }
    return this.portSection(doc, nodes);
  }

  /** ポート構成の編集。複数の機器(構成が同じもの)を渡すと、変更は全員に反映する */
  private portSection(doc: DiagramDocument, nodes: readonly DiagramNode[]): HTMLElement {
    const node = nodes[0];
    const many = nodes.length > 1;
    const ids = nodes.map((n) => n.id);
    const back = () => (many ? this.updateMulti(ids.length, ids) : this.update(node.id));
    const tpl = getTemplate(doc, node.templateId);
    const groups: PortGroup[] = tpl ? structuredClone(resolvePortGroups(tpl, node)) : [];
    const section = el('div', { className: 'section' }, [el('h3', { text: t('props.ports') })]);

    const commit = (next: PortGroup[]) => {
      const lost = ids.flatMap((id) => lostEdgeIds(this.ctx.getDoc(), this.ctx.pageId, id, next));
      if (lost.length > 0 && !this.ctx.confirm(t('confirm.removePorts', { count: lost.length }))) {
        back(); // 取り消し: 入力欄を元の値へ戻す
        return;
      }
      const r = this.ctx.apply(many ? setPortGroupsMany(this.ctx.pageId, ids, next, { removeOrphanEdges: lost.length > 0 }) : setPortGroups(this.ctx.pageId, node.id, next, { removeOrphanEdges: lost.length > 0 }));
      if (!r.ok) back();
    };

    groups.forEach((g, i) => {
      const edit = (patch: Partial<PortGroup>) => commit(groups.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      const row = el('div', { className: 'group-row', attrs: { 'data-group': g.id } }, [
        field(t('props.signal'), this.signalSelect(doc, g, (v) => edit({ signalType: v }))),
        field(t('props.direction'), this.directionSelect(g, (v) => edit({ direction: v }))),
        field(t('props.side'), this.sideSelect(g, (v) => edit({ side: v }))),
        field(
          t('props.portCount'),
          el('input', {
            attrs: { type: 'number', min: '0', step: '1', value: String(g.count), 'data-prop': 'port-count' },
            on: { change: (ev) => edit({ count: Number((ev.target as HTMLInputElement).value) }) },
          }),
        ),
        field(t('props.connections'), this.multiSelect(g, (v) => edit({ multi: v }))),
        field(
          t('props.prefix'),
          el('input', { attrs: { type: 'text', value: g.labelPrefix, 'data-prop': 'port-prefix' }, on: { change: (ev) => edit({ labelPrefix: (ev.target as HTMLInputElement).value }) } }),
        ),
        el('button', {
          className: 'danger',
          text: t('props.removeGroup'),
          attrs: { type: 'button', 'data-action': 'remove-group' },
          on: { click: () => commit(groups.filter((_, j) => j !== i)) },
        }),
      ]);
      section.append(row);
    });

    section.append(el('p', { className: 'hint', text: many ? t('props.portsBulkHint') : t('props.portMoveHint') }));
    if (!many && node.portPlacements) {
      section.append(
        el('button', {
          text: t('props.resetPorts'),
          attrs: { type: 'button', 'data-action': 'reset-ports' },
          on: { click: () => this.ctx.apply(clearPortPlacements(this.ctx.pageId, node.id)) },
        }),
      );
    }
    section.append(
      el('button', {
        text: t('props.addGroup'),
        attrs: { type: 'button', 'data-action': 'add-group' },
        on: {
          click: () => {
            const signal = doc.signalTypes[0];
            if (!signal) return;
            const id = uniqueId(signal.id.toLowerCase(), groups.map((x) => x.id));
            commit([...groups, { id, signalType: signal.id, direction: 'inout', side: 'left', count: 1, labelPrefix: `${signal.label} ` }]);
          },
        },
      }),
    );
    return section;
  }

  private signalSelect(doc: DiagramDocument, g: PortGroup, on: (v: string) => void): HTMLSelectElement {
    const s = select(doc.signalTypes.map((x) => ({ value: x.id, label: x.label })), g.signalType);
    s.setAttribute('data-prop', 'port-signal');
    s.addEventListener('change', () => on(s.value));
    return s;
  }

  private directionSelect(g: PortGroup, on: (v: Direction) => void): HTMLSelectElement {
    const s = select(DIRECTIONS.map((d) => ({ value: d, label: t(`direction.${d}` as MessageKey) })), g.direction);
    s.setAttribute('data-prop', 'port-direction');
    s.addEventListener('change', () => on(s.value as Direction));
    return s;
  }

  private multiSelect(g: PortGroup, on: (v: boolean) => void): HTMLSelectElement {
    const s = select(
      [
        { value: 'single', label: t('props.connSingle') },
        { value: 'multi', label: t('props.connMulti') },
      ],
      g.multi ? 'multi' : 'single',
    );
    s.setAttribute('data-prop', 'port-multi');
    s.addEventListener('change', () => on(s.value === 'multi'));
    return s;
  }

  private sideSelect(g: PortGroup, on: (v: Side) => void): HTMLSelectElement {
    const s = select(SIDES.map((x) => ({ value: x, label: t(`side.${x}` as MessageKey) })), g.side);
    s.setAttribute('data-prop', 'port-side');
    s.addEventListener('change', () => on(s.value as Side));
    return s;
  }
}
