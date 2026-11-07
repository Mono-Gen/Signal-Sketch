// Vite の「?raw」付き読み込み(ファイルの中身を文字列で受け取る)の型。テストでだけ使う。
declare module '*?raw' {
  const content: string;
  export default content;
}
