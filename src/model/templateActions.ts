import type { Action } from './actions';
import { uniqueId } from './ids';
import { resolvePortGroups } from './ports';
import { getPage, getTemplate } from './query';

/** 図全体で保持できるテンプレート数。標準機器を図へ取り込んだ分も含む */
export const MAX_TEMPLATES = 200;

/** 「この図の機器」へ登録できる名称の最大文字数 */
export const MAX_TEMPLATE_NAME_LENGTH = 100;

/** 新しい登録だけに使うID接頭辞。読み込んだ旧来テンプレートや標準機器は管理対象にしない */
export function isCustomTemplateId(id: string): boolean {
  return id.startsWith('custom-');
}

/** 同名の登録がある場合に、`名称 (2)` から順に最初の空きを選ぶ */
function uniqueRegistrationName(name: string, existing: readonly string[]): string {
  const names = new Set(existing);
  if (!names.has(name)) return name;
  let suffix = 2;
  while (true) {
    const tail = ` (${suffix})`;
    // 自動で付ける番号も含めて上限内に保つ。入力名そのものは、番号が不要なら切り詰めない
    const candidate = `${name.slice(0, MAX_TEMPLATE_NAME_LENGTH - tail.length)}${tail}`;
    if (!names.has(candidate)) return candidate;
    suffix++;
  }
}

/**
 * 置かれている機器の見た目と有効なポート構成を、図内で再利用するテンプレートとして登録する。
 * 責任: テンプレートの作成。対象外: 入力ダイアログとパレット表示。
 */
export function registerTemplate(pageId: string, nodeId: string, requestedName: string): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return { ok: false, error: 'unknown-page' };
    const node = page.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return { ok: false, error: 'unknown-node' };
    const source = getTemplate(doc, node.templateId);
    if (!source) return { ok: false, error: 'unknown-template' };

    const baseName = requestedName.trim();
    if (baseName.length === 0 || baseName.length > MAX_TEMPLATE_NAME_LENGTH) return { ok: false, error: 'invalid-value' };
    if (doc.deviceTemplates.length >= MAX_TEMPLATES) return { ok: false, error: 'too-many-templates' };
    if (node.imageId && typeof doc.assets?.[node.imageId] !== 'string') return { ok: false, error: 'invalid-value' };

    const customNames = doc.deviceTemplates.filter((template) => isCustomTemplateId(template.id)).map((template) => template.name);
    const id = uniqueId('custom', doc.deviceTemplates.map((template) => template.id));
    doc.deviceTemplates.push({
      id,
      name: uniqueRegistrationName(baseName, customNames),
      kind: source.kind,
      shape: source.shape,
      portGroups: structuredClone(resolvePortGroups(source, node)),
      ...(node.imageId ? { imageId: node.imageId } : {}),
      size: { w: node.w, h: node.h },
    });
    return { ok: true };
  };
}

/** 使用中ではない「この図の機器」だけを削除する。標準機器と不明なIDは削除しない */
export function removeTemplate(templateId: string): Action {
  return (doc) => {
    const index = doc.deviceTemplates.findIndex((template) => template.id === templateId);
    if (index < 0 || !isCustomTemplateId(templateId)) return { ok: false, error: 'unknown-template' };
    if (doc.pages.some((page) => page.nodes.some((node) => node.templateId === templateId))) {
      return { ok: false, error: 'template-in-use' };
    }
    doc.deviceTemplates.splice(index, 1);
    return { ok: true };
  };
}
