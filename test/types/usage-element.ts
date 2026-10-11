// The element's types: the tag map, the typed events and the methods.
import '@rhylthyme/timeline/element';
import type { RhylthymeTimelineLabels } from '@rhylthyme/timeline/element';

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
  el.labels = {
    chartSubtitle: (tracks, total, seconds) => `${tracks} pistes · ${total} (${seconds.toFixed(0)} s)`,
    legendDependency: 'dépendance',
    noProgram: (property, attribute) => `Aucun programme : ${property} / ${attribute}`,
    speedOption: (factor, formatted) => `${formatted} ×`,
  };
  el.locale = 'fr';
  el.locale = null;
  // The labels attribute takes the string-only form of the same table.
  const frText: Partial<Record<keyof RhylthymeTimelineLabels, string>> = { stop: 'Arrêter', startStep: 'Démarrer : {0}' };
  el.labels = frText;
  el.setAttribute('labels', JSON.stringify(frText));
  const clockText: string = el.formatTime(90);
  void clockText;
  // @ts-expect-error chartSubtitle's first argument is a count
  el.labels = { chartSubtitle: (tracks: string) => tracks };
  // @ts-expect-error startStep takes a step id
  el.startStep(1);
}
