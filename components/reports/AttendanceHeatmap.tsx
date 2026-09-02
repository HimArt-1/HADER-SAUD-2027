import React from 'react';

interface HeatmapData {
  day: string;
  hours: number[]; // e.g. [0, 5, 12, 3, 0] for different time slots
}

interface AttendanceHeatmapProps {
  data: HeatmapData[];
  labels: string[]; // e.g., ["07:00", "08:00", "09:00", "10:00"]
}

const getColorForIntensity = (value: number, max: number) => {
  if (value === 0) return 'bg-white/5 border-white/5';
  const ratio = value / max;
  if (ratio < 0.25) return 'bg-primary-500/20 border-primary-500/30';
  if (ratio < 0.5) return 'bg-primary-500/50 border-primary-500/60';
  if (ratio < 0.75) return 'bg-primary-400 border-primary-400 shadow-[0_0_10px_rgb(var(--color-primary-400)_/_0.5)]';
  return 'bg-primary-300 border-primary-300 shadow-[0_0_15px_rgb(var(--color-primary-300)_/_0.8)]';
};

export const AttendanceHeatmap: React.FC<AttendanceHeatmapProps> = ({ data, labels }) => {
  // Find maximum value to scale colors
  const maxValue = Math.max(...data.flatMap(d => d.hours), 1);

  return (
    <div className="w-full overflow-x-auto pb-4">
      <div className="flex flex-col min-w-[max-content] gap-2">
        {/* Header Row (Hours) */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-20"></div> {/* Empty space for Days column */}
          {labels.map((label, idx) => (
            <div key={idx} className="w-10 text-center text-xs text-slate-400 font-mono">
              {label}
            </div>
          ))}
        </div>

        {/* Heatmap Rows */}
        {data.map((row, rIdx) => (
          <div key={rIdx} className="flex items-center gap-2">
            <div className="w-20 text-sm text-slate-300 font-bold text-right pt-1 pr-2">
              {row.day}
            </div>
            {row.hours.map((value, hIdx) => (
              <div
                key={hIdx}
                className="group relative w-10 h-10 flex items-center justify-center p-0.5"
              >
                <div 
                  className={`w-full h-full rounded-md border transition-all duration-300 ${getColorForIntensity(value, maxValue)} hover:scale-110`}
                ></div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 border border-slate-700">
                  {value} حالة
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      
      {/* Legend */}
      <div className="mt-6 flex items-center justify-end gap-4 text-xs text-slate-400">
        <span>نشاط منخفض</span>
        <div className="flex gap-1">
          <div className="w-4 h-4 rounded-sm bg-white/5 border border-white/5"></div>
          <div className="w-4 h-4 rounded-sm bg-primary-500/20 border border-primary-500/30"></div>
          <div className="w-4 h-4 rounded-sm bg-primary-500/50 border border-primary-500/60"></div>
          <div className="w-4 h-4 rounded-sm bg-primary-400 border border-primary-400"></div>
          <div className="w-4 h-4 rounded-sm bg-primary-300 border border-primary-300"></div>
        </div>
        <span>نشاط عالي</span>
      </div>
    </div>
  );
};
