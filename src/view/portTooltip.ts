import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Port } from '../model/ports';
import { escapeHtml } from '../util/escapeHtml';

/**
 * ポートのツールチップの文。maxGraph のツールチップは、文字列を HTML として画面へ挿入する(innerHTML)ため、
 * ファイル由来の値(ポートの表示名・信号の名前)は必ずエスケープして埋め込む。
 * 責任: ツールチップの文を作ること。対象外: 表示位置・表示のタイミング(maxGraph が行う)。
 */
export function portTooltipHtml(port: Pick<Port, 'label' | 'direction' | 'unit' | 'signalType'>, signalLabel: string | undefined, showUnit: boolean): string {
  const label = showUnit ? `${port.label}(${t('tooltip.unit', { unit: port.unit })})` : port.label;
  return t('tooltip.port', {
    label: escapeHtml(label),
    signal: escapeHtml(signalLabel ?? port.signalType),
    direction: escapeHtml(t(`direction.${port.direction}` as MessageKey)),
  });
}
