import type { FitCourseInput } from '../fit';
import { gpxFilename } from '../gpx';

const instructionsKey = 'route-builder-garmin-hide-instructions';

export function installGarminDialog() {
  const dialog = document.getElementById('garmin-dialog') as HTMLDialogElement;
  const hide = document.getElementById('garmin-hide-instructions') as HTMLInputElement;
  let returnFocus: HTMLElement | null = null;
  document.getElementById('garmin-close')!.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  hide.onchange = () => {
    try { localStorage.setItem(instructionsKey, String(hide.checked)); } catch { /* Keep the session choice. */ }
  };
  try { hide.checked = localStorage.getItem(instructionsKey) === 'true'; } catch { /* Show instructions by default. */ }
  return (trigger: HTMLElement | null = null) => {
    if (!hide.checked && !dialog.open) { returnFocus = trigger; dialog.showModal(); }
  };
}

let fitModule: Promise<typeof import('../fit')> | null = null;
let loadedFitModule: typeof import('../fit') | null = null;
export function preloadFit() {
  fitModule ??= import('../fit').then(module => (loadedFitModule = module));
  fitModule.catch(() => { fitModule = null; });
  return fitModule;
}

/** Generate FIT before sharing; a preloaded encoder preserves the synchronous click-to-share path. */
export async function sendGarminCourse(input: Omit<FitCourseInput, 'timeCreated' | 'serialNumber'>, showInstructions: () => void) {
  const { generateFitCourse } = loadedFitModule ?? await preloadFit();
  const serialNumber = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const bytes = generateFitCourse({ ...input, timeCreated: new Date(), serialNumber });
  const file = new File([new Uint8Array(bytes)], gpxFilename(input.name).replace(/\.gpx$/, '.fit'), { type: 'application/octet-stream' });
  if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: input.name });
      return 'shared' as const;
    }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
      // Sharing can be denied or lose user activation; keep the generated FIT available via download.
    }
  }
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  showInstructions();
  return 'downloaded' as const;
}
