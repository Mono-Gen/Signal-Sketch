import type { DocumentStore } from '../state/store';
import type { DiagramView } from '../view/diagramView';
import { clampZoom, fitZoom, stepZoom } from '../view/zoom';

export interface ZoomControlsDeps {
  view: DiagramView;
  store: DocumentStore;
  /** 図を含むスクロール領域と、その中の図+凡例を包む要素 */
  stageEl: HTMLElement;
  wrapEl: HTMLElement;
  legendEl: HTMLElement;
  buttons: { zoomIn: HTMLElement; zoomOut: HTMLElement; reset: HTMLElement; fit: HTMLElement };
  /** 拡大率が変わったとき(背景の点の間隔と、凡例の幅を合わせ直すため) */
  onChange(): void;
}

export interface ZoomControls {
  zoomTo(zoom: number, anchor?: { clientX: number; clientY: number }): void;
  /** 1段階、拡大(+1)または縮小(-1) */
  step(direction: 1 | -1): void;
  /** 100% に戻す */
  reset(): void;
  /** 図全体が表示領域に収まる拡大率にする */
  fit(): void;
}

/**
 * 拡大縮小の操作(ボタン・Ctrl+ホイール・全体表示・中ボタンのドラッグでの表示位置の移動)。
 * 拡大率は表示だけの状態で、図のデータには保存しない。
 * 責任: 操作を拡大率の変更とスクロールへ変えること。対象外: 拡大率の計算(view/zoom)・描画(DiagramView)。
 */
export function installZoomControls(deps: ZoomControlsDeps): ZoomControls {
  const { view, store, stageEl, wrapEl, legendEl, buttons } = deps;

  view.onZoomChange = (z) => {
    buttons.reset.textContent = `${Math.round(z * 100)}%`;
    deps.onChange(); // 背景の点の間隔と、凡例の幅を合わせる
  };

  /**
   * 拡大率を変える(anchor を与えると、その下の図の点を動かさない)。
   * 拡大中は、図の右・下に余白を足してスクロール範囲を確保する。余白が無いと、図の端に近い所での
   * カーソル中心の拡大が、スクロールの上限に阻まれて位置がずれる。等倍以下では余白を置かない。
   */
  function zoomTo(z: number, anchor?: { clientX: number; clientY: number }): void {
    const next = clampZoom(z);
    wrapEl.style.paddingRight = next > 1 ? '40vw' : '0';
    wrapEl.style.paddingBottom = next > 1 ? '40vh' : '0';
    view.setZoom(next, anchor, stageEl);
  }

  /** 図全体が表示領域に収まる拡大率にする(凡例の高さも見込む) */
  function fit(): void {
    const cs = getComputedStyle(stageEl);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border = 2; // 図の外枠(1px×2)
    zoomTo(fitZoom(store.doc.pages[0].size, { w: stageEl.clientWidth - padX - border, h: stageEl.clientHeight - padY - border - legendEl.offsetHeight }));
    stageEl.scrollLeft = 0;
    stageEl.scrollTop = 0;
  }

  const step = (direction: 1 | -1) => zoomTo(stepZoom(view.getZoom(), direction));
  const reset = () => zoomTo(1);

  buttons.zoomIn.addEventListener('click', () => step(1));
  buttons.zoomOut.addEventListener('click', () => step(-1));
  buttons.reset.addEventListener('click', reset);
  buttons.fit.addEventListener('click', fit);

  // Ctrl+ホイール(トラックパッドのピンチを含む)でカーソル位置を中心に拡大縮小。ふつうのホイールはスクロール
  stageEl.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault(); // ブラウザ自身のページ拡大を起こさない
      const factor = Math.exp(-ev.deltaY * 0.0015);
      zoomTo(Math.round(view.getZoom() * factor * 100) / 100, { clientX: ev.clientX, clientY: ev.clientY });
    },
    { passive: false },
  );

  // 中ボタン(ホイール押し込み)のドラッグで、表示位置を動かす。
  // ブラウザ標準の中ボタンの自動スクロール(動きが重なる)は mousedown で止める
  stageEl.addEventListener('mousedown', (ev) => {
    if (ev.button === 1) ev.preventDefault();
  });
  stageEl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 1) return;
    ev.preventDefault();
    // 1回ごとの移動量を足し込むと、スクロール位置の整数化で小数が毎回丸められ誤差が溜まる。
    // 開始時の位置からの総移動量で決める。
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startLeft = stageEl.scrollLeft;
    const startTop = stageEl.scrollTop;
    const move = (e: PointerEvent) => {
      stageEl.scrollLeft = startLeft - (e.clientX - startX);
      stageEl.scrollTop = startTop - (e.clientY - startY);
    };
    // ボタンを離した通知が届かない場合(pointercancel・ウィンドウを切り替えた blur)も終わらせる。
    // 終わらないと、離したあとのマウスの動きでも、表示が動き続ける
    const up = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
  });

  return { zoomTo, step, reset, fit };
}
