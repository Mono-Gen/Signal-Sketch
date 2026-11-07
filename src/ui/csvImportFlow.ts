import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import { decodeCsvBytes, MAX_CSV_BYTES, parseDeviceCsv } from '../io/csvImport';
import type { Action, ActionResult } from '../model/actions';
import { documentLimitIssue } from '../model/docLimits';
import { importDevices } from '../model/importDevices';
import { PRESETS, presetToTemplate } from '../model/presets';
import type { DocumentStore } from '../state/store';
import { errorText } from './errorText';
import { formatImportErrors, formatImportWarnings, warningsBlock } from './importMessages';
import type { SetStatus } from './statusBar';

export interface CsvImportDeps {
  store: DocumentStore;
  pageId: string;
  apply(action: Action): ActionResult;
  setStatus: SetStatus;
  /** 追加した機器・枠を選んだ状態にする */
  selectItems(nodeIds: readonly string[], frameIds: readonly string[]): void;
}

/**
 * 機器一覧のCSVを読み込み、機器と枠を追加する(接続は作らない)。
 * 検証 → 試しに追加して結果を確認(複製の図で実行。本物は変えない)→ 確認の画面 → 追加、の順。
 * エラーが1件でもあれば何も追加しない。警告(知らない列・不明な種類・置けない機器など)は確認の画面に出す。
 * 責任: 読み込みの流れ(ファイル → 検証 → 確認 → 追加)。対象外: CSVの解析(io/csvImport)・配置(model/importDevices)。
 */
export function createCsvImport(deps: CsvImportDeps): (file: File) => Promise<void> {
  const { store, pageId, apply, setStatus } = deps;

  return async function importCsv(file: File): Promise<void> {
    if (file.size > MAX_CSV_BYTES) {
      setStatus('error', t('import.error.prefix', { reasons: t('status.fileTooLarge', { mb: MAX_CSV_BYTES / 1024 / 1024 }) }));
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      setStatus('error', t('import.error.prefix', { reasons: (err as Error).message }));
      return;
    }
    const decoded = decodeCsvBytes(bytes);
    const parsed = parseDeviceCsv(decoded.text);
    if (!parsed.ok) {
      setStatus('error', formatImportErrors(parsed.errors));
      return;
    }
    const options = {
      templateFor: (presetId: string) => {
        const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
        return presetToTemplate(preset, t(`preset.${preset.id}` as MessageKey));
      },
    };
    const probeDoc = structuredClone(store.doc);
    const probe = importDevices(pageId, parsed.rows, options)(probeDoc);
    if (!probe.ok) {
      setStatus('error', errorText(probe));
      return;
    }
    if (documentLimitIssue(probeDoc)) {
      setStatus('error', errorText({ ok: false, error: 'document-too-large' })); // 追加すると図全体の上限を超える場合は、確認の前に断る
      return;
    }
    const lines = formatImportWarnings(parsed.warnings, { shiftJis: decoded.encoding === 'shift_jis', garbled: decoded.garbled, unplaced: probe.unplaced ?? [] });
    const nodes = probe.createdNodeIds?.length ?? 0;
    const frames = probe.createdFrameIds?.length ?? 0;
    if (!window.confirm(t('confirm.importCsv', { nodes, rows: parsed.rows.length, frames, warnings: warningsBlock(lines) }))) return;
    const r = apply(importDevices(pageId, parsed.rows, options));
    if (!r.ok) return;
    deps.selectItems(r.createdNodeIds ?? [], r.createdFrameIds ?? []);
    setStatus('ok', t('status.csvImported', { nodes: r.createdNodeIds?.length ?? 0, frames: r.createdFrameIds?.length ?? 0 }));
  };
}
