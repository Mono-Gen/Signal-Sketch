import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * ビルド出力(単一のHTML)の先頭に、同梱している第三者ソフトウェア(maxGraph)の表示を入れる。
 * 圧縮で著作権表示が消えるため、Apache License 2.0 が求める「ライセンスの写しを添える」ことを、
 * HTMLファイルだけを渡された場合でも満たすための処理。本文は THIRD_PARTY_NOTICES.md と licenses/ と同じもの。
 */
function licenseNotice(): Plugin {
  const license = readFileSync('licenses/maxGraph-LICENSE.txt', 'utf8');
  return {
    name: 'license-notice',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const notice = [
          'This file bundles maxGraph (@maxgraph/core), licensed under the Apache License 2.0.',
          'Copyright 2021-present The maxGraph project Contributors; Copyright (c) 2006-2020 JGraph Ltd; Copyright (c) 2006-2018 Gaudenz Alder; Copyright (c) 2006-2020 draw.io AG.',
          'Project: https://github.com/maxGraph/maxGraph',
          'License text:',
          license,
        ].join('\n');
        // コメントの終端記号が混ざるとHTMLが壊れるので、含まれていないことを確認する
        if (notice.includes('--')) throw new Error('ライセンス文に「--」が含まれています。HTMLコメントに入れられません');
        return html.replace('<head>', `<head>\n<!--\n${notice}\n-->`);
      },
    },
  };
}

/**
 * 製品ビルドのHTMLに、Content-Security-Policy を入れる。このアプリは外部へ通信しないので、通信・外部の読み込み・
 * フォーム送信・埋め込みをすべて禁止する(万一、図のファイルに悪意のある値が入っていても、データを外へ出せないようにする多層防御)。
 * JS/CSSは単一HTMLへインライン化されるため、script-src / style-src は 'unsafe-inline' が要る。
 * img-src の data: はアイコン、blob: は PNG への変換に使う。開発サーバー(HMR)を壊さないよう、ビルド時だけ入れる。
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('<head>', `<head>
<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  };
}

// file:// で開くため、JS/CSSを1つのHTMLへインライン化する(設計書 3章)
export default defineConfig({
  plugins: [viteSingleFile(), licenseNotice(), contentSecurityPolicy()],
  // 動的な読み込みを使わないので、Vite の modulepreload polyfill は不要(出力に入れない。同梱する外部コードを maxGraph だけにする)
  build: { target: 'es2022', modulePreload: false },
});
