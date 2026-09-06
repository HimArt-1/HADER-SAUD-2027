import React, { useEffect, useState } from 'react';
import { kioskPresenceService, type KioskStatus } from '../services/kioskPresenceService';

export default function SupportKioskDiagnostics() {
  const [kiosks, setKiosks] = useState<KioskStatus[]>([]);
  useEffect(() => kioskPresenceService.listenForPresence(setKiosks), []);

  return <div className="space-y-4">
    <p className="text-sm text-slate-300">تعتمد الحالة على إشارات الكشك المباشرة؛ تتغير إلى غير متصل عند انقطاعها.</p>
    {kiosks.length === 0 && <p className="text-amber-300">لم تصل إشارة من أي كشك بعد. تحقق من تشغيل الكشك واتصاله بالخادم.</p>}
    {kiosks.map(kiosk => <div key={kiosk.kioskId} className="p-4 rounded-xl border border-white/10 bg-slate-800/30 space-y-2">
      <h4 className="font-bold text-white">{kiosk.kioskName}</h4>
      <p className={kiosk.status === 'online' ? 'text-emerald-300' : 'text-amber-300'}>
        {kiosk.status === 'online' ? 'متصل' : kiosk.status === 'emergency' ? 'وضع الطوارئ' : 'غير متصل'}
      </p>
      <p className="text-sm text-slate-300">آخر إشارة: {new Date(kiosk.lastSeen).toLocaleString('ar-SA')}</p>
      <p className="text-sm text-slate-300">عناصر تنتظر المزامنة: {kiosk.syncPending}</p>
      <p className="text-sm text-slate-300">الكاميرا عند آخر إشارة: {kiosk.cameraReady ? 'جاهزة' : 'غير جاهزة'}</p>
    </div>)}
    <p className="text-sm text-amber-300">إعادة تهيئة واجهة الكشك وتركيز الباركود من هذه اللوحة غير متاحين حالياً؛ يتطلبان ربط تنفيذ الأوامر وتأكيد استلامها.</p>
  </div>;
}
