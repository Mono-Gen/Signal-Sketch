/**
 * ユーザー入力(機器名・型番)をHTMLラベルへ埋め込む前に無害化する。
 * 取り込んだJSONに含まれる文字列が、そのままHTMLとして解釈されないようにする(XSS対策)。
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
