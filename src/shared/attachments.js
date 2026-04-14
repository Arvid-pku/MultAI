export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncateName(name, max = 22) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot > max - 3) return name.slice(0, max - 1) + '…';
  const ext = name.slice(dot);
  const base = name.slice(0, max - ext.length - 1);
  return `${base}…${ext}`;
}

export function isImage(file) {
  return (file.type || '').startsWith('image/');
}
