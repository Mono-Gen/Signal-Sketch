// ブラウザのファイル操作(保存ダイアログ・ダウンロード・読込)。
// File System Access API が使えれば上書き保存でき、使えなければダウンロードにフォールバックする(設計書 3章)。

interface SaveHandle {
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveHandle>;

export interface FileFormat {
  description: string;
  mime: string;
  extension: string;
}

const JSON_FORMAT: FileFormat = { description: 'JSON', mime: 'application/json', extension: '.json' };
export const CSV_FORMAT: FileFormat = { description: 'CSV', mime: 'text/csv', extension: '.csv' };
export const SVG_FORMAT: FileFormat = { description: 'SVG', mime: 'image/svg+xml', extension: '.svg' };
export const PNG_FORMAT: FileFormat = { description: 'PNG', mime: 'image/png', extension: '.png' };

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

const pickerOf = (): SavePicker | undefined => (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

/**
 * データ(文字列またはBlob)を保存する。保存ダイアログを取り消した場合は 'cancelled'。
 * それ以外の失敗は握りつぶさず、例外として呼び出し側へ伝える。
 */
export async function saveFile(data: string | Blob, suggestedName: string, format: FileFormat): Promise<SaveOutcome> {
  const picker = pickerOf();
  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: format.description, accept: { [format.mime]: [format.extension] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return 'saved';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  const blob = typeof data === 'string' ? new Blob([data], { type: format.mime }) : data;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return 'downloaded';
}

/** テキストを保存する(既定はJSON)。 */
export function saveTextFile(text: string, suggestedName: string, format: FileFormat = JSON_FORMAT): Promise<SaveOutcome> {
  return saveFile(text, suggestedName, format);
}

export function readTextFile(file: File): Promise<string> {
  return file.text();
}
