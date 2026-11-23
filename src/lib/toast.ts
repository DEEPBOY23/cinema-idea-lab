// Retours visuels discrets après une action (« Idée enregistrée ✓ »).
export function toast(message: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('cil-toast', { detail: message }));
}
