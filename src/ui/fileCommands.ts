import { t } from '../i18n';
import { CSV_FORMAT, PNG_FORMAT, SVG_FORMAT, isLikelyLockedError, readTextFile, saveFile, saveTextFile } from '../io/browserFile';
import { buildDeviceCsv, CSV_BOM } from '../io/csvExport';
import { MAX_DOCUMENT_BYTES, parseDocument, serializeDocument } from '../io/fileIo';
import { buildSvg, svgToPng } from '../io/svgExport';
import type { DocumentStore } from '../state/store';
import type { DiagramView } from '../view/diagramView';
import type { SetStatus } from './statusBar';
import { themeFor } from '../view/theme';
import type { ThemeName } from '../view/theme';

export function exportBackground(theme: ThemeName): string {
  return themeFor(theme).signalPaper ?? '#ffffff';
}

export interface FileCommandsDeps {
  store: DocumentStore;
  view: DiagramView;
  pageId: string;
  setStatus: SetStatus;
  getTheme(): ThemeName;
}

export interface FileCommands {
  /** 未保存の変更があれば確認し、続けてよいかを返す */
  confirmDiscard(): boolean;
  save(): Promise<void>;
  exportCsv(): Promise<void>;
  exportImage(kind: 'svg' | 'png'): Promise<void>;
  openFile(file: File): Promise<void>;
}

/**
 * 図の保存・読み込みと、画像・機器一覧の出力。
 * 責任: ファイルとの入出力と、その結果の通知。対象外: 図の内容の検証(parseDocument)・画像や表の組み立て(io/)。
 */
export function createFileCommands(deps: FileCommandsDeps): FileCommands {
  const { store, view, pageId, setStatus } = deps;

  /** 保存の失敗を画面に出す。他のアプリが開いているらしいときは、対処を添える */
  const reportSaveError = (err: unknown): void => {
    const reason = (err as Error).message;
    setStatus('error', t(isLikelyLockedError(err) ? 'status.saveLocked' : 'status.saveFailed', { reason }));
  };

  const confirmDiscard = () => !store.isDirty || window.confirm(t('confirm.discard'));

  async function save(): Promise<void> {
    try {
      const outcome = await saveTextFile(serializeDocument(store.doc), 'diagram.json');
      if (outcome === 'cancelled') return;
      store.markSaved();
      setStatus('ok', t(outcome === 'saved' ? 'status.saved' : 'status.savedByDownload'));
    } catch (err) {
      reportSaveError(err);
    }
  }

  /** 機器一覧(名称・型番・台数など)をCSVで保存する。見出しは現在の表示言語 */
  async function exportCsv(): Promise<void> {
    const csv = buildDeviceCsv(store.doc, {
      name: t('csv.name'),
      model: t('csv.model'),
      quantity: t('csv.quantity'),
      kind: t('csv.kind'),
      ports: t('csv.ports'),
      place: t('csv.place'),
    });
    try {
      const outcome = await saveTextFile(CSV_BOM + csv, 'devices.csv', CSV_FORMAT);
      if (outcome !== 'cancelled') setStatus('ok', t('status.csvExported'));
    } catch (err) {
      reportSaveError(err);
    }
  }

  /** 現在の図を、画像として保存する(SVG または PNG)。文字はテキストとして出力するので、PowerPoint にも貼れる */
  async function exportImage(kind: 'svg' | 'png'): Promise<void> {
    try {
      const page = store.doc.pages[0];
      // 選択の枠(ハンドル)は出力に含まれない。経路だけを画面から受け取り、残りはモデルから描く
      // 折り返しは、画面と同じフォントで文字幅を実測して決める
      const ctx = document.createElement('canvas').getContext('2d');
      const measureText = (text: string, bold: boolean): number => {
        if (!ctx) return text.length * 7;
        ctx.font = `${bold ? 'bold 12px' : '11px'} "Yu Gothic UI", "Meiryo", sans-serif`;
        return ctx.measureText(text).width;
      };
      const svg = buildSvg(store.doc, pageId, {
        theme: themeFor(deps.getTheme()),
        measureText,
        edgePoints: view.getEdgePoints(),
        countText: (count) => t('node.count', { count }),
        legendTitle: t('legend.title'),
      });
      const outcome =
        kind === 'svg'
          ? await saveFile(svg, 'diagram.svg', SVG_FORMAT)
          : await saveFile(await svgToPng(svg, page.size.w, page.size.h + 40, 2, exportBackground(deps.getTheme())), 'diagram.png', PNG_FORMAT);
      if (outcome !== 'cancelled') setStatus('ok', t('status.imageExported'));
    } catch (err) {
      reportSaveError(err);
    }
  }

  async function openFile(file: File): Promise<void> {
    if (file.size > MAX_DOCUMENT_BYTES) {
      setStatus('error', t('status.loadFailed', { reason: t('status.fileTooLarge', { mb: MAX_DOCUMENT_BYTES / 1024 / 1024 }) }));
      return;
    }
    let text: string;
    try {
      text = await readTextFile(file);
    } catch (err) {
      setStatus('error', t('status.loadFailed', { reason: (err as Error).message })); // 読み取りに失敗したときも、理由を表示する
      return;
    }
    const result = parseDocument(text);
    if (!result.ok) {
      setStatus('error', t('status.loadFailed', { reason: result.errors.join(' / ') }));
      return;
    }
    store.replace(result.doc);
    const page = store.doc.pages[0];
    setStatus('ok', t('status.loaded', { nodes: page.nodes.length, edges: page.edges.length }));
  }

  return { confirmDiscard, save, exportCsv, exportImage, openFile };
}
