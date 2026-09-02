import React from 'react';

type Props = {
  columns: string[];
  rows: Record<string, unknown>[];
  title?: string;
};

export const PreviewTable: React.FC<Props> = ({ columns, rows, title }) => {
  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="text-sm text-gray-400">لا توجد بيانات للمعاينة.</div>
    );
  }

  return (
    <div className="space-y-2">
      {title && <h4 className="text-sm font-semibold text-white">{title}</h4>}
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="overflow-auto max-h-64">
          <table className="min-w-full text-xs text-right">
            <thead className="bg-white/10 text-gray-300">
              <tr>
                {columns.map(column => (
                  <th key={column} className="px-3 py-2 whitespace-nowrap">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-white/5">
                  {columns.map(column => (
                    <td key={`${index}-${column}`} className="px-3 py-2 text-gray-200 whitespace-nowrap">
                      {String(row[column] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-gray-500">يتم عرض أول 10 صفوف فقط.</p>
    </div>
  );
};
