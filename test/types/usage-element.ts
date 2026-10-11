// The element's types: the tag map, the typed events and the methods.
import '@rhylthyme/timeline/element';
import type { RhylthymeTimelineLabels } from '@rhylthyme/timeline/element';

const el = document.querySelector('rhylthyme-timeline');
el?.addEventListener('rt-step-start', (e) => { const id: string = e.detail.stepId; void id; });
el?.addEventListener('rt-step-complete', (e) => { const auto: boolean = e.detail.automatic; void auto; });
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
  // Translations: partial, strings or functions with typed arguments.
  const fr: Partial<RhylthymeTimelineLabels> = {
    start: 'Démarrer',
    startStep: (name) => `Démarrer : ${name}`,
    doneStep: 'Terminé : {0}',
    groupProgress: (name, count, done) => `${name} ×${count} — ${done} terminé(s)`,
  };
  el.labels = fr;
  el.labels = null;
  const startText: RhylthymeTimelineLabels['start'] = el.labels.start;
  void startText;
  // @ts-expect-error startStep's argument is the step name, a string
  el.labels = { startStep: (name: number) => String(name) };
  // @ts-expect-error unknown label key
  el.labels = { begin: 'Go' };
  // @ts-expect-error startStep takes a step id
  el.startStep(1);
}
