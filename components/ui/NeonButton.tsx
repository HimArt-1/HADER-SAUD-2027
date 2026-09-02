import React, { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

export interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

export function NeonButton({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  startIcon,
  endIcon,
  className = '',
  children,
  disabled,
  ...props
}: NeonButtonProps) {
  
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return 'bg-gradient-primary-blue text-white shadow-neon hover:shadow-neon-lg border border-primary-400/50';
      case 'outline':
        return 'bg-transparent text-primary-400 border border-primary-500/50 hover:bg-primary-500/10 hover:shadow-neon';
      case 'danger':
        return 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:shadow-[0_0_40px_rgba(239,68,68,0.6)] border border-red-400/50';
      case 'ghost':
        return 'bg-transparent text-gray-300 hover:bg-white/10 hover:text-white border border-transparent';
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm': return 'h-9 px-4 text-xs';
      case 'md': return 'h-11 px-6 text-sm';
      case 'lg': return 'h-14 px-8 text-base';
    }
  };

  const baseStyles = 'relative inline-flex items-center justify-center font-bold font-sans rounded-xl transition-all duration-300 overflow-hidden focus-neon outline-none';
  const isDisabled = disabled || isLoading;

  return (
    <button
      disabled={isDisabled}
      className={`
        ${baseStyles} 
        ${getVariantStyles()} 
        ${getSizeStyles()} 
        ${isDisabled ? 'opacity-50 cursor-not-allowed filter grayscale-[40%]' : 'hover:scale-[0.98] active:scale-95'}
        ${className}
      `}
      {...props}
    >
      {variant === 'primary' && !isDisabled && (
        <span className="absolute inset-0 rounded-xl bg-white/20 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none"></span>
      )}

      {isLoading && <Loader2 className="w-4 h-4 me-2 animate-smooth-spin" />}
      {!isLoading && startIcon && <span className="me-2 flex-shrink-0">{startIcon}</span>}
      <span className="truncate flex-1">{children}</span>
      {!isLoading && endIcon && <span className="ms-2 flex-shrink-0">{endIcon}</span>}
    </button>
  );
}
