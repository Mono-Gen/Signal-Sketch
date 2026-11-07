// import.meta.env の型(Vite が実行時に差し込む値のうち、使うものだけ)。
// Vite の型定義一式(vite/client)を読み込まずに済ませるため、必要な部分だけを宣言する。
interface ImportMeta {
  readonly env: { readonly MODE: string };
}
