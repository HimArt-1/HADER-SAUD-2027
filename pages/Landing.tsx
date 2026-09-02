import React, { useEffect } from 'react';

/**
 * بوابة الانتقال إلى صفحة حاضر التسويقية المستقلة.
 * إبقاء الصفحة التسويقية كمستند مستقل يعزل هويتها البصرية عن أنماط لوحة النظام.
 */
const Landing: React.FC = () => {
  useEffect(() => {
    window.location.replace(new URL('landing/index.html', window.location.href).href);
  }, []);

  return (
    <main
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100"
      aria-live="polite"
    >
      <p className="text-sm text-slate-400">جاري فتح منصة حاضر...</p>
    </main>
  );
};

export default Landing;
