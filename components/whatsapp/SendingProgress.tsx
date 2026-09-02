import React, { useMemo } from 'react';
import { Send, CheckCircle, XCircle, Clock, Loader2, Zap, TrendingUp } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// 📊 Sending Progress Component
// شريط تقدم احترافي للإرسال الجماعي
// ═══════════════════════════════════════════════════════════════

interface QueueItem {
  id: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
}

interface SendingProgressProps {
  queue: QueueItem[];
  isPaused?: boolean;
  className?: string;
}

const SendingProgress: React.FC<SendingProgressProps> = ({
  queue,
  isPaused = false,
  className = ''
}) => {
  // حساب الإحصائيات
  const stats = useMemo(() => {
    const total = queue.length;
    const sent = queue.filter(q => q.status === 'sent').length;
    const failed = queue.filter(q => q.status === 'failed').length;
    const pending = queue.filter(q => q.status === 'pending').length;
    const sending = queue.filter(q => q.status === 'sending').length;
    
    const completed = sent + failed;
    const progress = total > 0 ? (completed / total) * 100 : 0;
    const successRate = completed > 0 ? (sent / completed) * 100 : 0;
    
    return { total, sent, failed, pending, sending, completed, progress, successRate };
  }, [queue]);

  // لا تعرض أي شيء إذا كان الطابور فارغاً
  if (stats.total === 0) return null;

  // تحديد لون شريط التقدم
  const getProgressColor = () => {
    if (stats.failed > 0 && stats.sent === 0) return 'from-red-500 to-red-600';
    if (stats.failed > stats.sent) return 'from-amber-500 to-orange-500';
    return 'from-cyan-500 to-blue-500';
  };

  // تحديد حالة العملية
  const getStatusInfo = () => {
    if (isPaused) {
      return { icon: Clock, text: 'متوقف مؤقتاً', color: 'text-amber-400' };
    }
    if (stats.sending > 0) {
      return { icon: Loader2, text: 'جاري الإرسال...', color: 'text-cyan-400', animate: true };
    }
    if (stats.progress === 100) {
      return { icon: CheckCircle, text: 'اكتمل الإرسال', color: 'text-emerald-400' };
    }
    if (stats.pending > 0) {
      return { icon: Clock, text: 'في انتظار الإرسال', color: 'text-gray-400' };
    }
    return { icon: Send, text: 'جاهز', color: 'text-gray-400' };
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  return (
    <div className={`bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50 ${className}`}>
      {/* رأس الشريط */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StatusIcon 
            className={`w-5 h-5 ${statusInfo.color} ${statusInfo.animate ? 'animate-spin' : ''}`} 
          />
          <span className={`text-sm font-bold ${statusInfo.color}`}>
            {statusInfo.text}
          </span>
        </div>
        
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <TrendingUp className="w-3 h-3" />
          <span>{stats.progress.toFixed(0)}%</span>
        </div>
      </div>

      {/* شريط التقدم */}
      <div className="relative h-3 bg-slate-900/60 rounded-full overflow-hidden mb-3">
        {/* الخلفية المتحركة */}
        <div 
          className={`
            absolute inset-0 bg-gradient-to-r ${getProgressColor()}
            transition-all duration-500 ease-out
            ${stats.sending > 0 ? 'animate-progress-pulse' : ''}
          `}
          style={{ width: `${stats.progress}%` }}
        />
        
        {/* تأثير التوهج */}
        {stats.sending > 0 && (
          <div 
            className="absolute top-0 h-full w-20 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"
            style={{ 
              left: `${Math.max(0, stats.progress - 10)}%`,
            }}
          />
        )}
        
        {/* خطوط الرسائل الفردية (للطوابير الصغيرة) */}
        {stats.total <= 20 && (
          <div className="absolute inset-0 flex">
            {queue.map((item, index) => (
              <div
                key={item.id}
                className={`
                  flex-1 border-l border-slate-700/30 first:border-l-0
                  ${item.status === 'sent' ? 'bg-emerald-500/20' : ''}
                  ${item.status === 'failed' ? 'bg-red-500/30' : ''}
                  ${item.status === 'sending' ? 'bg-cyan-500/40 animate-pulse' : ''}
                `}
                title={`رسالة ${index + 1}: ${item.status === 'sent' ? 'تم الإرسال' : item.status === 'failed' ? 'فشل' : item.status === 'sending' ? 'جاري الإرسال' : 'في الانتظار'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* إحصائيات مفصلة */}
      <div className="grid grid-cols-4 gap-2">
        {/* المعلقة */}
        <StatBox
          icon={<Clock className="w-4 h-4" />}
          value={stats.pending}
          label="معلقة"
          color="text-gray-400"
          bgColor="bg-gray-500/10"
        />
        
        {/* جاري الإرسال */}
        <StatBox
          icon={<Zap className="w-4 h-4" />}
          value={stats.sending}
          label="جاري"
          color="text-cyan-400"
          bgColor="bg-cyan-500/10"
          pulse={stats.sending > 0}
        />
        
        {/* تم الإرسال */}
        <StatBox
          icon={<CheckCircle className="w-4 h-4" />}
          value={stats.sent}
          label="نجحت"
          color="text-emerald-400"
          bgColor="bg-emerald-500/10"
        />
        
        {/* فشلت */}
        <StatBox
          icon={<XCircle className="w-4 h-4" />}
          value={stats.failed}
          label="فشلت"
          color="text-red-400"
          bgColor="bg-red-500/10"
        />
      </div>

      {/* نسبة النجاح */}
      {stats.completed > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/30 flex items-center justify-between">
          <span className="text-xs text-gray-500">نسبة النجاح</span>
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-slate-900/60 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  stats.successRate >= 90 ? 'bg-emerald-500' :
                  stats.successRate >= 70 ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${stats.successRate}%` }}
              />
            </div>
            <span className={`text-xs font-bold ${
              stats.successRate >= 90 ? 'text-emerald-400' :
              stats.successRate >= 70 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {stats.successRate.toFixed(0)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 📦 مكون الإحصائية الفردية
// ═══════════════════════════════════════════════════════════════

interface StatBoxProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  color: string;
  bgColor: string;
  pulse?: boolean;
}

const StatBox: React.FC<StatBoxProps> = ({
  icon,
  value,
  label,
  color,
  bgColor,
  pulse = false
}) => (
  <div className={`
    ${bgColor} rounded-xl p-2 text-center transition-all duration-300
    ${pulse ? 'animate-pulse ring-1 ring-cyan-500/30' : ''}
  `}>
    <div className={`flex justify-center mb-1 ${color}`}>
      {icon}
    </div>
    <div className={`text-lg font-black ${color}`}>
      {value}
    </div>
    <div className="text-[10px] text-gray-500 font-medium">
      {label}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 🎯 نسخة مصغرة للشريط العلوي
// ═══════════════════════════════════════════════════════════════

export const MiniProgress: React.FC<{
  queue: QueueItem[];
  className?: string;
}> = ({ queue, className = '' }) => {
  const stats = useMemo(() => {
    const total = queue.length;
    const completed = queue.filter(q => q.status === 'sent' || q.status === 'failed').length;
    const sending = queue.filter(q => q.status === 'sending').length;
    const progress = total > 0 ? (completed / total) * 100 : 0;
    return { total, completed, sending, progress };
  }, [queue]);

  if (stats.total === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div 
          className={`h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 ${
            stats.sending > 0 ? 'animate-progress-pulse' : ''
          }`}
          style={{ width: `${stats.progress}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 font-mono">
        {stats.completed}/{stats.total}
      </span>
    </div>
  );
};

export default SendingProgress;
