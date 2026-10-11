export async function shareRoute(title: string, url: string, copied: () => void, fallback: () => void, shared: () => void) {
  if (matchMedia('(pointer: coarse)').matches && navigator.share) {
    try { await navigator.share({ title, url }); shared(); return; }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
    }
  }
  try { await navigator.clipboard.writeText(url); }
  catch { fallback(); return; }
  copied();
}
