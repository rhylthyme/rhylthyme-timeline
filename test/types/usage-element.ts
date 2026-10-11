// The element's types: the tag map, the typed events and the methods.
import '@rhylthyme/timeline/element';

const el = document.querySelector('rhylthyme-timeline');
el?.addEventListener('rt-step-start', (e) => { const id: string = e.detail.stepId; void id; });
el?.addEventListener('rt-step-complete', (e) => { const auto: boolean = e.detail.automatic; void auto; });
el?.addEventListener('rt-step-began', (e) => {
  const by: 'person' | 'plan' = e.detail.by;
  const at: number = e.detail.time;
  void by; void at; void e.detail.stepId;
});
el?.addEventListener('rt-step-ended', (e) => {
  const by: 'person' | 'timer' | 'trigger' | 'abort' = e.detail.by;
  // @ts-expect-error a step never ends by "plan"
  const wrong: 'plan' = e.detail.by;
  void by; void wrong;
});
if (el) {
  el.program = { tracks: [] };
  el.start();
  const s: 'stopped' | 'running' | 'paused' | 'completed' = el.status;
  void s;
  el.factors = { turkeyKg: 6.4 };
  el.speed = 60;
  const skipped: string[] = [];
  el.addEventListener('rt-factors', (e) => { skipped.push(...e.detail.skipped); });
  if (el.askFactors()) el.reconcileClock();
  // @ts-expect-error startStep takes a step id
  el.startStep(1);
}
