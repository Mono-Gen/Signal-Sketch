// 機器の種類別ピクトグラム(24x24の線画)。既定アイコンとして使い、
// ユーザーが取り込んだ画像で差し替えられる(設計書 D5。差し替えは次のユニット以降)。

const PATHS: Record<string, string> = {
  camera: '<rect x="2" y="7" width="14" height="10" rx="2"/><path d="M16 11l6-3v8l-6-3z"/>',
  display: '<rect x="2" y="4" width="20" height="13" rx="1.5"/><path d="M9 21h6M12 17v4"/>',
  speaker: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
  switch: '<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>',
  pc: '<rect x="3" y="5" width="18" height="11" rx="1.5"/><path d="M2 20h20"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7 15h10M7 10h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  amp: '<rect x="2" y="6" width="20" height="12" rx="1.5"/><circle cx="16" cy="12" r="2.5"/><path d="M5 12h6"/>',
  generic: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 12h10"/>',
};

/** 種類に対応するアイコンのdata URI。未知の種類は generic にする */
export function iconDataUri(kind: string, color: string): string {
  const body = PATHS[kind] ?? PATHS.generic;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export const KNOWN_ICON_KINDS: readonly string[] = Object.keys(PATHS);

/**
 * アイコンを、そのままSVGに埋め込める <g> として返す(SVG出力用)。
 * 画像参照(data URI)ではなく図形として埋め込むので、PowerPoint など画像を入れ子にできない環境でも表示できる。
 */
export function iconSvgGroup(kind: string, color: string, x: number, y: number, size: number): string {
  const body = PATHS[kind] ?? PATHS.generic;
  return (
    `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</g>`
  );
}
