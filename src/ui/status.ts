export type StatusKind = 'info' | 'busy' | 'warn';
const priority = { info: 0, busy: 1, warn: 2 };
export class StatusMessages {
  private messages = new Map<string, { message: string; kind: StatusKind }>();
  constructor(private element: HTMLElement) {}
  set(source: string, message: string, kind: StatusKind = 'info') {
    this.messages.delete(source);
    if (message) this.messages.set(source, { message, kind });
    const current = [...this.messages.values()].reverse().sort((a, b) => priority[b.kind] - priority[a.kind])[0];
    this.element.className = `status${current && current.kind !== 'info' ? ` ${current.kind}` : ''}`;
    this.element.lastElementChild!.textContent = current?.message ?? '';
    this.element.title = current?.message ?? '';
  }
}
