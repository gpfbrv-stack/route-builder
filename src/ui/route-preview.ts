import type { Router } from '../routing';
import type { RouteState, Segment } from '../types';

/** One live batch at a time; coalesce moves while busy instead of queuing old positions. */
export class RoutePreview {
  private generation = 0;
  private lastRequest = -Infinity;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  private latest?: { state: RouteState; index: number; generation: number };
  constructor(private router: Router, private draw: (state: RouteState) => void,
    private resolved: (index: number, segment: Segment) => void) {}
  update(state: RouteState, index: number) {
    this.latest = { state, index, generation: ++this.generation };
    this.draw(state);
    this.schedule();
  }
  cancel() { this.generation++; this.latest = undefined; clearTimeout(this.timer); }
  private schedule() {
    clearTimeout(this.timer);
    if (this.busy || !this.latest) return;
    const { state, index } = this.latest;
    if (!state.legMode.slice(Math.max(0, index - 1), index + 1).some(mode => mode !== 'straight')) return;
    this.timer = setTimeout(() => void this.request(), Math.max(0, 400 - (Date.now() - this.lastRequest)));
  }
  private async request() {
    const job = this.latest;
    if (!job) return;
    this.busy = true; this.lastRequest = Date.now();
    const first = Math.max(0, job.index - 1), end = Math.min(job.state.points.length - 1, job.index + 1);
    const current = () => this.generation === job.generation;
    try {
      await this.router.route(job.state.points.slice(first, end + 1), job.state.legProfiles.slice(first, end), current,
        (index, segment) => { if (current()) this.resolved(first + index, segment); }, job.state.legMode.slice(first, end), job.state.legPrefer?.slice(first, end));
    } finally {
      this.busy = false;
      if (this.latest && !current()) this.schedule();
    }
  }
}
