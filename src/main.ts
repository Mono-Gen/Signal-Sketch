import { getLanguage, loadSavedLanguage, setLanguage, t } from './i18n';
import type { MessageKey } from './i18n';
import { addNodeFromTemplate, addNodesInRow, setGridEnabled } from './model/actions';
import type { Action, ActionResult } from './model/actions';
import { createEmptyDocument } from './model/defaults';
import { diagnose } from './model/diagnostics';
import { addFrame, moveSelection } from './model/frames';
import { addNote, moveNotes } from './model/noteActions';
import { PRESETS, presetToTemplate } from './model/presets';
import { getTemplate } from './model/query';
import { removeTemplate } from './model/templateActions';
import { DocumentStore } from './state/store';
import { createAppChrome } from './ui/appChrome';
import { createClipboardCommands } from './ui/clipboardCommands';
import { installContextMenu } from './ui/contextMenu';
import { createCsvImport } from './ui/csvImportFlow';
import { errorText } from './ui/errorText';
import { createFileCommands } from './ui/fileCommands';
import { Palette, DRAG_MIME } from './ui/palette';
import type { PaletteItem } from './ui/palette';
import { PropertiesPanel } from './ui/propertiesPanel';
import { installShortcuts } from './ui/shortcuts';
import { askRowLayout } from './ui/rowPlaceDialog';
import { createStatusBar } from './ui/statusBar';
import { createViewCallbacks } from './ui/viewCallbacks';
import { createThemeController } from './ui/themeMode';
import type { ThemeController } from './ui/themeMode';
import { installZoomControls } from './ui/zoomControls';
import { DiagramView } from './view/diagramView';
import { themeFor } from './view/theme';
import type { ThemeName } from './view/theme';

// アプリの組み立て(配線)だけを行う。各機能は ui/ の部品が持ち、ここでは部品を作って、互いにつなぐ。

const PAGE_ID = 'page-1';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const graphEl = $('graph');

loadSavedLanguage();
const store = new DocumentStore(createEmptyDocument()); // 起動時は空の図。サンプルは docs/ のファイルを「開く」で読み込む
const statusBar = createStatusBar($('status'));
const setStatus = statusBar.set;

/** 操作を適用し、失敗したら理由を表示する。画面を呼び出し元で戻すかどうかは結果で判断する */
function apply(action: Action): ActionResult {
  const r = store.apply(action);
  if (!r.ok) setStatus('error', errorText(r));
  return r;
}

// ビューとパネルは、互いのコールバックから参照されるので、作成後に取り出せるようにしておく
const view: DiagramView = new DiagramView(graphEl, store, createViewCallbacks({ pageId: PAGE_ID, apply, setStatus, getStatusText: statusBar.text, getView: () => view, getPanel: () => panel }));

const panel = new PropertiesPanel($('props'), {
  getDoc: () => store.doc,
  pageId: PAGE_ID,
  apply,
  confirm: (message) => window.confirm(message),
  getDiagnostics: () => diagnose(store.doc),
  selectEdge: (edgeId) => view.selectEdge(edgeId),
  getEpoch: () => store.epoch,
  setStatus,
});

/** パレットの項目から機器を追加する。位置を省略すると空き位置へ置き、追加した機器を選択する */
function addFromPalette(item: PaletteItem, at?: { x: number; y: number }): void {
  if (item.source === 'frame') {
    const r = apply(addFrame(PAGE_ID, t('frame.default'), at));
    if (r.ok && r.created) {
      view.selectFrame(r.created);
      setStatus('ok', t('status.frameAdded'));
    }
    return;
  }
  if (item.source === 'note') {
    const r = apply(addNote(PAGE_ID, at ?? { x: store.doc.grid.size * 4, y: store.doc.grid.size * 4 }));
    if (r.ok && r.created) {
      view.selectNote(r.created);
      setStatus('ok', t('status.noteAdded'));
    }
    return;
  }
  const template = templateOf(item);
  if (!template) {
    setStatus('error', t('error.unknownTemplate'));
    return;
  }
  const r = apply(addNodeFromTemplate(PAGE_ID, template, template.name, at));
  if (r.ok && r.created) {
    view.selectNode(r.created);
    setStatus('ok', t('status.deviceAdded'));
  }
}

/** パレットの項目に対応する機器のテンプレート(標準機器は定義から作る)。無ければ undefined */
function templateOf(item: PaletteItem) {
  const preset = item.source === 'preset' ? PRESETS.find((p) => p.id === item.id) : undefined;
  return preset ? presetToTemplate(preset, t(`preset.${preset.id}` as MessageKey)) : getTemplate(store.doc, item.id);
}

/** Shift を押してドロップされたとき: 個数・向き・間隔を尋ねて、同じ機器を一列に並べて追加する(枠は対象外) */
async function addRowFromPalette(item: PaletteItem, at: { x: number; y: number }): Promise<void> {
  const template = templateOf(item);
  if (!template) {
    setStatus('error', t('error.unknownTemplate'));
    return;
  }
  const layout = await askRowLayout(store.doc.grid.size * 2);
  if (!layout) return; // 取り消し
  // ダイアログを開いている間に図が変わった場合に備え、確定時にテンプレートを引き直す
  const current = templateOf(item);
  if (!current) {
    setStatus('error', t('error.unknownTemplate'));
    return;
  }
  const r = apply(addNodesInRow(PAGE_ID, current, current.name, layout, at));
  if (r.ok && r.createdNodeIds) {
    view.selectNodes(r.createdNodeIds);
    setStatus('ok', t('status.devicesAdded', { count: r.createdNodeIds.length }));
  }
}

let currentTheme: ThemeName = 'light'; // テーマ制御の初期化(下)で、実際の値に更新される
const palette = new Palette(
  $('palette'),
  () => store.doc,
  (item) => addFromPalette(item),
  (templateId) => {
    if (apply(removeTemplate(templateId)).ok) setStatus('ok', t('status.deviceRegistrationRemoved'));
  },
  () => themeFor(currentTheme),
);

// パレットからキャンバスへのドラッグ&ドロップ
graphEl.addEventListener('dragover', (ev) => {
  if (ev.dataTransfer?.types.includes(DRAG_MIME)) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }
});
graphEl.addEventListener('drop', (ev) => {
  const raw = ev.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return;
  ev.preventDefault();
  try {
    const item = JSON.parse(raw) as PaletteItem;
    const at = view.clientToGraph(ev.clientX, ev.clientY);
    if (ev.shiftKey && item.source !== 'frame' && item.source !== 'note') void addRowFromPalette(item, at);
    else addFromPalette(item, at);
  } catch {
    setStatus('error', t('error.unknownTemplate')); // 想定外のデータが落とされた場合
  }
});

const stageEl = $('stage');
const wrapEl = $('canvas-wrap');
const legendEl = $('legend');
const gridChk = $<HTMLInputElement>('chk-grid');

const chrome = createAppChrome({
  store,
  view,
  graphEl,
  wrapEl,
  legendEl,
  appNameEl: $('app-name'),
  getTheme: () => themeFor(currentTheme),
  gridCheckbox: gridChk,
  buttons: { undo: $<HTMLButtonElement>('btn-undo'), redo: $<HTMLButtonElement>('btn-redo'), checks: $<HTMLButtonElement>('btn-checks') },
});

function refresh(): void {
  view.render(); // 描き直しの最後に選択を復元し、プロパティパネルも更新される
  palette.render();
  chrome.renderLegend();
  chrome.syncToolbar();
  syncThemeButton();
}

store.subscribe(refresh);

// 画面の配色(自動/ライト/ダーク)。出力する画像には影響しない(常に明るい配色)
const themeBtn = $<HTMLButtonElement>('btn-theme');
const THEME_LABEL: Record<'auto' | 'light' | 'dark', MessageKey> = { auto: 'toolbar.themeAuto', light: 'toolbar.themeLight', dark: 'toolbar.themeDark' };
function syncThemeButton(): void {
  themeBtn.textContent = t(THEME_LABEL[themeCtl.preference]);
  themeBtn.title = t('toolbar.themeTitle');
}
const themeCtl: ThemeController = createThemeController({
  root: document.documentElement,
  storage: typeof localStorage === 'undefined' ? undefined : localStorage,
  systemQuery: typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined,
  onChange: (effective) => {
    currentTheme = effective;
    view.setTheme(themeFor(effective));
    palette.render();
    chrome.renderLegend();
  },
});
themeBtn.addEventListener('click', () => {
  themeCtl.cycle();
  syncThemeButton();
});

const files = createFileCommands({ store, view, pageId: PAGE_ID, setStatus });
const importCsv = createCsvImport({ store, pageId: PAGE_ID, apply, setStatus, selectItems: (nodeIds, frameIds) => view.selectItems(nodeIds, frameIds) });
const clipboard = createClipboardCommands({ store, view, pageId: PAGE_ID, apply, setStatus });
installContextMenu({ container: graphEl, view, store, pageId: PAGE_ID, apply, setStatus, clipboard });

/** ボタンから選んだファイルを受け取る隠しの入力欄。同じファイルを続けて選んでも change が発火するよう、受け取ったら空にする */
function wireFileInput(input: HTMLInputElement, onFile: (file: File) => void): void {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
}
const fileInput = $<HTMLInputElement>('file-open');
const csvInput = $<HTMLInputElement>('file-import-csv');
wireFileInput(fileInput, (file) => void files.openFile(file));
wireFileInput(csvInput, (file) => void importCsv(file));

$('btn-new').addEventListener('click', () => {
  if (files.confirmDiscard()) store.replace(createEmptyDocument());
});
$('btn-open').addEventListener('click', () => {
  if (files.confirmDiscard()) fileInput.click();
});
$('btn-save').addEventListener('click', () => void files.save());
$('btn-svg').addEventListener('click', () => void files.exportImage('svg'));
$('btn-png').addEventListener('click', () => void files.exportImage('png'));
$('btn-csv').addEventListener('click', () => void files.exportCsv());
$('btn-import-csv').addEventListener('click', () => csvInput.click());
$('btn-checks').addEventListener('click', () => view.clearSelection());
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
$('btn-delete').addEventListener('click', clipboard.deleteSelection);
gridChk.addEventListener('change', () => store.apply(setGridEnabled(gridChk.checked)));
$('btn-lang').addEventListener('click', () => {
  setLanguage(getLanguage() === 'ja' ? 'en' : 'ja');
  chrome.applyStaticTexts();
  refresh();
  setStatus('info', t('status.ready'));
});

const zoom = installZoomControls({
  view,
  store,
  stageEl,
  wrapEl,
  legendEl,
  buttons: { zoomIn: $('btn-zoom-in'), zoomOut: $('btn-zoom-out'), reset: $('btn-zoom-reset'), fit: $('btn-zoom-fit') },
  onChange: chrome.syncToolbar,
});

/** 選択中の機器・枠を、グリッド1つ分(グリッドが無効でも同じ幅)だけ動かす。矢印キー用 */
function nudgeSelection(dx: number, dy: number): void {
  const sel = view.getSelection();
  const page = store.doc.pages.find((p) => p.id === PAGE_ID);
  if (!page || (sel.nodeIds.length === 0 && sel.frameIds.length === 0 && sel.noteIds.length === 0)) return;
  const step = store.doc.grid.size;
  const nodeMoves = page.nodes.filter((n) => sel.nodeIds.includes(n.id)).map((n) => ({ id: n.id, x: n.x + dx * step, y: n.y + dy * step }));
  const frameMoves = page.groups.filter((g) => sel.frameIds.includes(g.id)).map((g) => ({ id: g.id, x: g.x + dx * step, y: g.y + dy * step }));
  const noteMoves = (page.notes ?? []).filter((m) => sel.noteIds.includes(m.id)).map((m) => ({ id: m.id, x: m.x + dx * step, y: m.y + dy * step }));
  // 機器・枠とメモを1回の操作にする(元に戻すで一度に戻る)
  apply((doc) => {
    const r = moveSelection(PAGE_ID, nodeMoves, frameMoves)(doc);
    return r.ok && noteMoves.length > 0 ? moveNotes(PAGE_ID, noteMoves)(doc) : r;
  });
}

installShortcuts({
  zoomIn: () => zoom.step(1),
  zoomOut: () => zoom.step(-1),
  zoomReset: zoom.reset,
  undo: () => store.undo(),
  redo: () => store.redo(),
  copy: clipboard.copy,
  paste: clipboard.paste,
  duplicate: clipboard.duplicate,
  save: () => void files.save(),
  selectAll: () => view.selectAll(),
  escape: () => view.clearPortSelection(),
  deleteSelection: clipboard.deleteSelection,
  nudge: nudgeSelection,
});

// 未保存の変更があるままタブを閉じようとしたときの警告
window.addEventListener('beforeunload', (ev) => {
  if (store.isDirty) ev.preventDefault();
});

chrome.applyStaticTexts();
refresh();
setStatus('info', t('status.ready'));

// 自動検証用のフック(window.__app)。実ブラウザでの検証用のビルド(`npm run build:e2e`)でだけ、?debug=1 のときに公開する。
// 配布する本番ビルドには入れない(内部のオブジェクトを、ページの外から触れる状態にしないため)。
// MODE は Vite がビルド時に定数として置き換えるので、本番ビルドでは、この分岐ごと取り除かれる。
if (import.meta.env.MODE === 'e2e' && new URLSearchParams(location.search).get('debug') === '1') {
  (window as unknown as { __app: unknown }).__app = { store, view, panel, palette };
}
