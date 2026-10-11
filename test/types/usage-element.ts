// The element's types: the tag map, the typed events and the methods.
import '@rhylthyme/timeline/element';

const el = document.querySelector('rhylthyme-timeline');
el?.addEventListener('rt-step-start', (e) => { const id: string = e.detail.stepId; void id; });
el?.addEventListener('rt-step-complete', (e) => { const auto: boolean = e.detail.automatic; void auto; });
if (el) {
  el.program = { tracks: [] };
  el.start();
  const s: 'stopped' | 'running' | 'paused' | 'completed' = el.status;
  void s;
  // @ts-expect-error startStep takes a step id
  el.startStep(1);
}
