// vite.config.ts が使う node:fs の、必要な1関数だけの型宣言。
// Node の型パッケージ(@types/node)を依存に加えずに、型検査を通すため(依存の追加は利用者の同意が要る)。
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
