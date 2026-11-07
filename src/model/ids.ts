/**
 * 既存IDと衝突しない「接頭辞-番号」のIDを作る。
 * 既存の最大番号+1を使うので、現在存在するIDとは必ず異なる。
 * (最大番号のIDを削除した直後は、その番号が再び使われる。履歴で復元される機器とは
 * 衝突しない前提 — Undoは状態ごと戻すため。)
 */
export function uniqueId(prefix: string, existing: Iterable<string>): string {
  const head = `${prefix}-`;
  const all = new Set(existing);
  let max = 0;
  for (const id of all) {
    if (!id.startsWith(head)) continue;
    const n = Number(id.slice(head.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  // 読み込んだ図に、数として正確に扱えない大きな番号(2^53 以上)があると +1 しても同じ値になり、重複する。
  // その場合は、別の接尾辞(u1, u2, …)で空きを探す
  if (!Number.isSafeInteger(max + 1)) {
    let k = 1;
    while (all.has(`${head}u${k}`)) k++;
    return `${head}u${k}`;
  }
  return `${head}${max + 1}`;
}
