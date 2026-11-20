import { useEffect } from 'react';

export const inputClass = 'w-full rounded-lg border border-life-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-life-500 focus:outline-none focus:ring-2 focus:ring-life-200 dark:border-life-700 dark:bg-life-800 dark:text-life-50';
export const buttonClass = 'rounded-full bg-gradient-to-br from-life-500 to-life-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:from-life-600 hover:to-life-800 disabled:opacity-50';
export const quietButtonClass = 'rounded-lg border border-life-200 px-3 py-1.5 text-sm text-life-700 hover:bg-life-50 dark:border-life-700 dark:text-life-100 dark:hover:bg-life-800';
export const cardClass = 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-life-100 dark:bg-life-800 dark:ring-life-700 sm:p-5';

export function errorMessage(err, fallback) {
  const d = err?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  return fallback;
}

export function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-gray-600 dark:text-life-200">{label}</span>
      {children}
    </label>
  );
}

export default function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl dark:bg-life-800 sm:rounded-2xl sm:p-6 ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-life-800 dark:text-life-50">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-2 text-xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const toDateInput = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const fromDateInput = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export const minutesText = (m) => (m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
