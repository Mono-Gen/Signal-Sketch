import { t } from '../i18n';
import type { Action, ActionResult } from '../model/actions';
import { applyNodeMoves } from '../model/align';
import type { NodeMove } from '../model/align';
import type { SetStatus } from './statusBar';

export interface AlignCommandDeps {
  pageId: string;
  apply(action: Action): ActionResult;
  setStatus: SetStatus;
}

/**
 * 揃え・等間隔の計画を適用して、結果を状態表示に出す。パネルのボタンと右クリックメニューで共有する。
 * 動く機器がなければ何も適用せず(元に戻す履歴を積まず)、その旨を知らせる。
 */
export function applyAlignPlan(moves: readonly NodeMove[], deps: AlignCommandDeps): void {
  if (moves.length === 0) {
    deps.setStatus('info', t('status.alignNothing'));
    return;
  }
  if (deps.apply(applyNodeMoves(deps.pageId, moves)).ok) deps.setStatus('ok', t('status.aligned', { count: moves.length }));
}
