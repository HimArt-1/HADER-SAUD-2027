import React from 'react';
import { AlertTriangle, Trash2, X, Check } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// 🔔 مكون التأكيد المخصص - بديل احترافي لـ confirm()
// ═══════════════════════════════════════════════════════════════

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  variant = 'danger',
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  const variantConfig = {
    danger: {
      icon: Trash2,
      iconBg: 'bg-red-500/20',
      iconColor: 'text-red-400',
      confirmBg: 'bg-red-600 hover:bg-red-500',
      confirmShadow: 'shadow-red-600/30'
    },
    warning: {
      icon: AlertTriangle,
      iconBg: 'bg-amber-500/20',
      iconColor: 'text-amber-400',
      confirmBg: 'bg-amber-600 hover:bg-amber-500',
      confirmShadow: 'shadow-amber-600/30'
    },
    info: {
      icon: Check,
      iconBg: 'bg-secondary-500/20',
      iconColor: 'text-secondary-400',
      confirmBg: 'bg-secondary-600 hover:bg-secondary-500',
      confirmShadow: 'shadow-secondary-600/30'
    }
  };

  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div 
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4"
      dir="rtl"
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onCancel}
      />
      
      {/* Dialog */}
      <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl shadow-2xl w-full max-w-md border border-white/10 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-2xl ${config.iconBg}`}>
              <Icon className={`w-6 h-6 ${config.iconColor}`} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-1">{title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{message}</p>
            </div>
            <button 
              onClick={onCancel}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Actions */}
        <div className="p-4 pt-2 flex gap-3 border-t border-white/5">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 rounded-xl bg-white/5 text-gray-300 font-bold hover:bg-white/10 transition-all border border-white/10"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onCancel();
            }}
            className={`flex-1 py-3 px-4 rounded-xl text-white font-bold transition-all shadow-lg ${config.confirmBg} ${config.confirmShadow}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 🪝 Hook لاستخدام التأكيد بسهولة
// ═══════════════════════════════════════════════════════════════

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
}

export const useConfirm = () => {
  const [state, setState] = React.useState<ConfirmState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const confirm = React.useCallback((options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        ...options,
        onConfirm: () => {
          resolve(true);
          setState(prev => ({ ...prev, isOpen: false }));
        }
      });
    });
  }, []);

  const close = React.useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const ConfirmDialogComponent = React.useCallback(() => (
    <ConfirmDialog
      isOpen={state.isOpen}
      title={state.title}
      message={state.message}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      variant={state.variant}
      onConfirm={state.onConfirm}
      onCancel={close}
    />
  ), [state, close]);

  return { confirm, ConfirmDialog: ConfirmDialogComponent };
};

export default ConfirmDialog;
