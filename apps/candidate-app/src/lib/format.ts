export const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export const fmtMoney = (v?: number | null) =>
  v == null ? '' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(v);

export const fmtSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} ב׳` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} ק״ב` : `${(bytes / 1048576).toFixed(1)} מ״ב`;
