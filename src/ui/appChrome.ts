import { APP_NAME } from '../app/appInfo';
import { getLanguage, t } from '../i18n';
import type { MessageKey } from '../i18n';
import { diagnose } from '../model/diagnostics';
import { orderedSignalTypes } from '../model/signalActions';
import { DASH_PATTERN, lineStyleOf } from '../model/lineStyle';
import type { DocumentStore } from '../state/store';
import type { DiagramView } from '../view/diagramView';
import { signalColor } from '../view/theme';
import type { Theme } from '../view/theme';

export interface AppChromeDeps {
  store: DocumentStore;
  view: DiagramView;
  graphEl: HTMLElement;
  /** 図+凡例を包む要素(凡例の幅を図の幅に合わせるため) */
  wrapEl: HTMLElement;
  legendEl: HTMLElement;
  appNameEl: HTMLElement;
  /** 現在のテーマ(凡例の色見本を、図と同じ補正で描くため) */
  getTheme(): Theme;
  gridCheckbox: HTMLInputElement;
  buttons: { undo: HTMLButtonElement; redo: HTMLButtonElement; checks: HTMLButtonElement };
}

export interface AppChrome {
  /** 凡例(信号の種類の色見本)を描き直す */
  renderLegend(): void;
  /** 画面の固定の文言(タイトル・ボタン名)を、現在の言語に直す */
  applyStaticTexts(): void;
  /** ツールバー(元に戻す・やり直し・確認事項の件数・グリッド吸着)と、図の背景・凡例の幅を、図の状態に合わせる */
  syncToolbar(): void;
}

/**
 * 画面の枠まわり(ツールバー・凡例・固定の文言)。図の状態から毎回作り直し、自分では状態を持たない
 * (確認事項の件数の増加を目立たせるための、直前の件数だけを除く)。
 * 責任: ツールバーと凡例の表示。対象外: 図の描画(DiagramView)・操作の実行(各コマンド)。
 */
export function createAppChrome(deps: AppChromeDeps): AppChrome {
  const { store, view, graphEl, wrapEl, legendEl, appNameEl, gridCheckbox, buttons } = deps;
  let lastIssueCount = 0;

  function renderLegend(): void {
    legendEl.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = t('legend.title');
    legendEl.append(title);
    const ordered = orderedSignalTypes(store.doc.signalTypes);
    let group: HTMLElement | undefined;
    for (const s of ordered) {
      if (!s.parent) {
        group = undefined;
        if (ordered.some((child) => child.parent === s.id)) {
          group = document.createElement('span');
          group.style.display = 'inline-flex';
          group.style.flexDirection = 'column';
          group.style.alignItems = 'flex-start';
          legendEl.append(group);
        }
      }
      const item = document.createElement('span');
      item.className = 'item';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      const color = signalColor(deps.getTheme(), s.color);
      const pattern = DASH_PATTERN[lineStyleOf(s)];
      // 破線・点線は、見本の帯を、色と透明の繰り返しで描く(パターンの「線 間隔」の数値を、そのまま使う)
      if (pattern) {
        const [on, off] = pattern.split(' ').map(Number);
        swatch.style.background = `repeating-linear-gradient(90deg, ${color} 0 ${on}px, transparent ${on}px ${on + off}px)`;
      } else swatch.style.background = color;
      item.append(swatch, document.createTextNode(s.label));
      if (s.parent) {
        item.style.marginLeft = '16px';
      }
      (group ?? legendEl).append(item);
    }
  }

  function applyStaticTexts(): void {
    document.documentElement.lang = getLanguage();
    document.title = APP_NAME;
    appNameEl.textContent = APP_NAME;
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n as MessageKey);
    }
  }

  function syncToolbar(): void {
    buttons.undo.disabled = !store.canUndo;
    buttons.redo.disabled = !store.canRedo;
    const issues = diagnose(store.doc);
    const checks = buttons.checks;
    checks.textContent = (issues.some((d) => d.severity === 'error') ? '✕ ' : issues.length > 0 ? '⚠ ' : '') + t('check.button', { count: issues.length });
    checks.dataset.state = issues.length === 0 ? 'ok' : issues.some((d) => d.severity === 'error') ? 'error' : 'warn';
    // 件数が増えた瞬間だけ、ボタンを一度目立たせる(右上のメッセージの代わりに、新しい指摘へ気付かせる)
    if (issues.length > lastIssueCount) {
      checks.classList.remove('flash');
      void checks.offsetWidth; // 連続して増えても、アニメーションを最初からやり直す
      checks.classList.add('flash');
    }
    lastIssueCount = issues.length;
    gridCheckbox.checked = store.doc.grid.enabled;
    wrapEl.style.width = `${graphEl.offsetWidth}px`; // 凡例の幅 = 図の幅(拡大率・ページの大きさの変更に追随)
    const cell = store.doc.grid.size * view.getZoom(); // 背景の点も拡大率に合わせる
    graphEl.style.backgroundSize = `${cell}px ${cell}px`;
    graphEl.style.backgroundImage = store.doc.grid.enabled ? 'radial-gradient(circle, var(--paper-dot) 1px, transparent 1.2px)' : 'none';
  }

  return { renderLegend, applyStaticTexts, syncToolbar };
}
