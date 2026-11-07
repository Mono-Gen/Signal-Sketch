// DOM組み立ての小さな補助。文字列はすべて textContent / value で入れ、
// ユーザー入力(機器名など)がHTMLとして解釈されないようにする。

export interface ElProps {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Record<string, (ev: Event) => void>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, fn] of Object.entries(props.on ?? {})) node.addEventListener(k, fn);
  for (const c of children) node.append(c);
  return node;
}

/** ラベル付きの入力欄(クリックで入力欄にフォーカスが移る) */
export function field(labelText: string, control: HTMLElement, className = 'field'): HTMLLabelElement {
  const label = el('label', { className });
  label.append(el('span', { className: 'field-label', text: labelText }), control);
  return label;
}

export function select(options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', { text: o.label, attrs: { value: o.value } });
    if (o.value === value) opt.selected = true;
    s.append(opt);
  }
  return s;
}
