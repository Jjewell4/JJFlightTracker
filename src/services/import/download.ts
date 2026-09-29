/** Triggers a browser download of text content (nothing leaves the device). */
export function downloadText(filename: string, text: string, mime = 'text/plain', bom = false): void {
  const blob = new Blob([bom ? '\uFEFF' : '', text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
