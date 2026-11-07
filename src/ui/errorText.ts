import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import type { ActionResult } from '../model/actions';
import { MAX_EDGES_PER_PAGE, MAX_NODES_PER_PAGE, MAX_PORTS_PER_PAGE } from '../model/docLimits';

/** 失敗理由のコード → 文言の辞書キー。モデルは言語を持たないので、文言はここで決める */
const ERROR_KEY: Record<NonNullable<ActionResult['error']>, MessageKey> = {
  'unknown-page': 'error.unknownPage',
  'unknown-node': 'error.unknownNode',
  'unknown-port': 'error.unknownPort',
  'unknown-template': 'error.unknownTemplate',
  'self-connection': 'error.selfConnection',
  'duplicate-edge': 'error.duplicateEdge',
  'port-occupied': 'error.portOccupied',
  'invalid-value': 'error.invalidValue',
  'invalid-port-groups': 'error.invalidPortGroups',
  'ports-in-use': 'error.portsInUse',
  'position-occupied': 'error.positionOccupied',
  'unknown-frame': 'error.unknownFrame',
  'unknown-signal': 'error.unknownSignal',
  'signal-in-use': 'error.signalInUse',
  'page-too-small': 'error.pageTooSmall',
  'import-no-space': 'error.importNoSpace',
  'document-too-large': 'error.documentTooLarge',
};

/** 名称を並べるとき、先頭の何件まで示すか(残りは件数にする) */
const MAX_NAMES_SHOWN = 3;

/**
 * 失敗理由の文言。ページを小さくできない場合・読み込みで置けない場合は、該当する機器・枠の名称も添える
 * (多いときは先頭3件+件数)。図が大きすぎる場合は、上限の数値を添える。
 */
export function errorText(r: ActionResult): string {
  if ((r.error === 'import-no-space' || r.error === 'page-too-small') && r.blockers) {
    const shown = r.blockers.slice(0, MAX_NAMES_SHOWN).join(t('list.separator'));
    const rest = r.blockers.length - MAX_NAMES_SHOWN;
    return t(ERROR_KEY[r.error], { names: rest > 0 ? t('list.more', { names: shown, count: rest }) : shown });
  }
  if (r.error === 'document-too-large') {
    return t('error.documentTooLarge', { nodes: MAX_NODES_PER_PAGE, ports: MAX_PORTS_PER_PAGE, edges: MAX_EDGES_PER_PAGE });
  }
  return t(ERROR_KEY[r.error!]);
}
