import React from 'react';

// ═══════════════════════════════════════════════════════════════
// 💀 Skeleton Components
// مكونات التحميل الهيكلية للعرض الأنيق أثناء التحميل
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 🧱 المكون الأساسي
// ═══════════════════════════════════════════════════════════════

interface SkeletonProps {
  className?: string;
  animate?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
  className = '', 
  animate = true 
}) => (
  <div 
    className={`
      bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800
      rounded-lg
      ${animate ? 'animate-shimmer bg-[length:200%_100%]' : ''}
      ${className}
    `}
  />
);

// ═══════════════════════════════════════════════════════════════
// 📊 Skeleton للإحصائيات
// ═══════════════════════════════════════════════════════════════

export const StatsSkeleton: React.FC = () => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
    {[1, 2, 3, 4].map((i) => (
      <div 
        key={i}
        className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50"
      >
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="h-6 w-12 rounded" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 📝 Skeleton لعنصر الطابور
// ═══════════════════════════════════════════════════════════════

export const QueueItemSkeleton: React.FC = () => (
  <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
    <div className="flex items-start gap-3">
      {/* أيقونة الحالة */}
      <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
      
      {/* المحتوى */}
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="h-12 w-full rounded" />
      </div>
      
      {/* أزرار التحكم */}
      <div className="flex gap-2">
        <Skeleton className="w-8 h-8 rounded-lg" />
        <Skeleton className="w-8 h-8 rounded-lg" />
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 📋 Skeleton لقائمة الطابور
// ═══════════════════════════════════════════════════════════════

export const QueueListSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div className="space-y-3 p-4">
    {/* رأس الطابور */}
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="h-5 w-32 rounded" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="w-24 h-8 rounded-xl" />
        <Skeleton className="w-8 h-8 rounded-xl" />
      </div>
    </div>
    
    {/* عناصر الطابور */}
    {Array.from({ length: count }).map((_, i) => (
      <QueueItemSkeleton key={i} />
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 🎨 Skeleton للقالب
// ═══════════════════════════════════════════════════════════════

export const TemplateSkeleton: React.FC = () => (
  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
    <div className="flex items-start gap-3">
      <Skeleton className="w-10 h-10 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-3/4 rounded" />
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 📇 Skeleton لبطاقة الطالب
// ═══════════════════════════════════════════════════════════════

export const StudentCardSkeleton: React.FC = () => (
  <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
    <div className="flex items-center gap-3">
      <Skeleton className="w-10 h-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
      <Skeleton className="w-6 h-6 rounded" />
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 👥 Skeleton لقائمة الطلاب
// ═══════════════════════════════════════════════════════════════

export const StudentListSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className="space-y-2">
    {Array.from({ length: count }).map((_, i) => (
      <StudentCardSkeleton key={i} />
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 📈 Skeleton للتقدم/النتائج
// ═══════════════════════════════════════════════════════════════

export const ProgressSkeleton: React.FC = () => (
  <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32 rounded" />
        <Skeleton className="h-5 w-16 rounded" />
      </div>
      <Skeleton className="h-3 w-full rounded-full" />
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="text-center space-y-1">
            <Skeleton className="h-8 w-12 mx-auto rounded" />
            <Skeleton className="h-3 w-16 mx-auto rounded" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 🖼️ Skeleton للشهادة
// ═══════════════════════════════════════════════════════════════

export const CertificateSkeleton: React.FC = () => (
  <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50 aspect-[4/3]">
    <div className="h-full flex flex-col items-center justify-center space-y-4">
      <Skeleton className="w-20 h-20 rounded-full" />
      <Skeleton className="h-6 w-48 rounded" />
      <Skeleton className="h-4 w-32 rounded" />
      <div className="flex gap-4 mt-4">
        <Skeleton className="w-16 h-16 rounded" />
        <Skeleton className="w-16 h-16 rounded" />
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 🎯 Skeleton شامل للصفحة
// ═══════════════════════════════════════════════════════════════

export const PageSkeleton: React.FC = () => (
  <div className="space-y-6 p-6">
    {/* رأس الصفحة */}
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48 rounded" />
        <Skeleton className="h-4 w-32 rounded" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="w-32 h-10 rounded-xl" />
        <Skeleton className="w-10 h-10 rounded-xl" />
      </div>
    </div>
    
    {/* الإحصائيات */}
    <StatsSkeleton />
    
    {/* المحتوى الرئيسي */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <QueueListSkeleton count={4} />
      <div className="space-y-4">
        <ProgressSkeleton />
        <TemplateSkeleton />
        <TemplateSkeleton />
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════
// 🎨 إضافة CSS Animation للـ Shimmer
// يجب إضافتها في index.css أو tailwind.config
// ═══════════════════════════════════════════════════════════════
/*
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  
  .animate-shimmer {
    animation: shimmer 1.5s ease-in-out infinite;
  }
*/

export default Skeleton;
