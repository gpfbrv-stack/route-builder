import type { RouteState } from './types';
export class History {
  private past: RouteState[] = [];
  constructor(public value: RouteState) {}
  set(next: RouteState) { this.past.push(structuredClone(this.value)); if (this.past.length > 50) this.past.shift(); this.value = structuredClone(next); }
  undo() { const previous = this.past.pop(); if (previous) this.value = previous; }
  get canUndo() { return this.past.length > 0; }
}
