import React, { FC, InputHTMLAttributes } from 'react';
import { Check } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   Neon Switch (Toggle)
   ═══════════════════════════════════════════════════════════════ */
export interface NeonSwitchProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
}

export const NeonSwitch: FC<NeonSwitchProps> = ({ 
  label, 
  description, 
  className = '', 
  id, 
  ...props 
}) => {
  const switchId = id || `switch-${Math.random().toString(36).substr(2, 9)}`;
  
  return (
    <label htmlFor={switchId} className={`flex items-center gap-3 cursor-pointer group ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <div className="relative flex items-center">
        <input 
          type="checkbox" 
          id={switchId} 
          className="peer sr-only" 
          {...props} 
        />
        <div className="w-12 h-6 bg-slate-800 rounded-full border border-slate-700/50 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-900 peer-checked:bg-primary-500/20 peer-checked:border-primary-500/50 transition-all duration-300 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] peer-checked:shadow-neon"></div>
        <div className="absolute top-1 start-1 w-4 h-4 bg-slate-400 rounded-full peer-checked:bg-primary-400 peer-checked:start-7 transition-all duration-300 shadow-md"></div>
      </div>
      {(label || description) && (
        <div className="flex flex-col">
          {label && <span className={`text-sm font-bold ${props.checked ? 'text-primary-300' : 'text-slate-300'} transition-colors duration-300`}>{label}</span>}
          {description && <span className="text-xs text-slate-500">{description}</span>}
        </div>
      )}
    </label>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Neon Checkbox
   ═══════════════════════════════════════════════════════════════ */
export interface NeonCheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const NeonCheckbox: FC<NeonCheckboxProps> = ({ 
  label, 
  className = '', 
  id, 
  ...props 
}) => {
  const checkboxId = id || `check-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <label htmlFor={checkboxId} className={`flex items-center gap-3 cursor-pointer group ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      <div className="relative flex items-center justify-center w-5 h-5">
        <input 
          type="checkbox" 
          id={checkboxId} 
          className="peer sr-only" 
          {...props} 
        />
        <div className="w-5 h-5 rounded bg-slate-800 border border-slate-600 peer-checked:bg-primary-500/20 peer-checked:border-primary-400 transition-all duration-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-900 peer-checked:shadow-neon"></div>
        <Check className="absolute w-3.5 h-3.5 text-primary-300 opacity-0 peer-checked:opacity-100 transform scale-50 peer-checked:scale-100 transition-all duration-300 pointer-events-none" strokeWidth={3} />
      </div>
      {label && <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors select-none">{label}</span>}
    </label>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Neon Input
   ═══════════════════════════════════════════════════════════════ */
export interface NeonInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  label?: string;
  error?: string;
}

export const NeonInput: FC<NeonInputProps> = ({ 
  icon, 
  label,
  error,
  className = '', 
  id, 
  ...props 
}) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      {label && <label htmlFor={inputId} className="text-sm font-bold text-slate-300 ms-1">{label}</label>}
      <div className="relative w-full">
        {icon && (
          <div className="absolute top-1/2 -translate-y-1/2 start-4 text-slate-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          className={`
            input-glass w-full rounded-xl h-12 transition-all duration-300 
            ${icon ? 'ps-11 pe-4' : 'px-4'} 
            ${error ? 'border-red-500/50 focus-visible:border-red-500 hover:border-red-500/70 focus-visible:shadow-[0_0_15px_rgba(239,68,68,0.3)]' : ''}
          `}
          {...props}
        />
      </div>
      {error && <span className="text-xs text-red-400 ms-1 animate-fade-in">{error}</span>}
    </div>
  );
};
