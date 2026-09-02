import { useState, useEffect, useCallback, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════
// 💾 Queue Persistence Hook
// حفظ واسترجاع الطابور محلياً لمنع فقدان البيانات
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'whatsapp_message_queue';
const BACKUP_KEY = 'whatsapp_message_queue_backup';
const MAX_BACKUP_AGE = 24 * 60 * 60 * 1000; // 24 ساعة

export interface QueueItem {
  id: string;
  studentName: string;
  phone: string;
  message: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  timestamp: number;
  statusLabel?: string;
  attachment?: string;
  retryCount?: number;
}

export interface QueuePersistenceState {
  lastSaved: Date | null;
  hasUnsavedChanges: boolean;
  recoveredFromBackup: boolean;
}

export interface UseQueuePersistenceOptions {
  /** التفعيل (الافتراضي: true) */
  enabled?: boolean;
  /** فترة الحفظ التلقائي بالمللي ثانية (الافتراضي: 5000) */
  autoSaveInterval?: number;
  /** الحفظ عند كل تغيير (الافتراضي: true) */
  saveOnChange?: boolean;
}

export function useQueuePersistence(options: UseQueuePersistenceOptions = {}) {
  const {
    enabled = true,
    autoSaveInterval = 5000,
    saveOnChange = true,
  } = options;

  const [state, setState] = useState<QueuePersistenceState>({
    lastSaved: null,
    hasUnsavedChanges: false,
    recoveredFromBackup: false,
  });

  const queueRef = useRef<QueueItem[]>([]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  // ═══════════════════════════════════════════════════════════════
  // 💾 حفظ الطابور
  // ═══════════════════════════════════════════════════════════════
  const saveQueue = useCallback((queue: QueueItem[], isBackup = false) => {
    if (!enabled) return false;
    
    try {
      const key = isBackup ? BACKUP_KEY : STORAGE_KEY;
      const data = {
        queue,
        savedAt: Date.now(),
        version: '2.0',
      };
      
      localStorage.setItem(key, JSON.stringify(data));
      
      if (!isBackup) {
        hasUnsavedChangesRef.current = false;
        setState(prev => ({
          ...prev,
          lastSaved: new Date(),
          hasUnsavedChanges: false,
        }));
      }
      
      return true;
    } catch (error) {
      console.error('فشل حفظ الطابور:', error);
      return false;
    }
  }, [enabled]);

  // ═══════════════════════════════════════════════════════════════
  // 📂 تحميل الطابور
  // ═══════════════════════════════════════════════════════════════
  const loadQueue = useCallback((): QueueItem[] | null => {
    if (!enabled) return null;
    
    try {
      // محاولة تحميل من التخزين الرئيسي
      const mainData = localStorage.getItem(STORAGE_KEY);
      if (mainData) {
        const parsed = JSON.parse(mainData);
        if (parsed.queue && Array.isArray(parsed.queue)) {
          queueRef.current = parsed.queue;
          return parsed.queue;
        }
      }
      
      // إذا فشل، محاولة الاسترداد من النسخة الاحتياطية
      const backupData = localStorage.getItem(BACKUP_KEY);
      if (backupData) {
        const parsed = JSON.parse(backupData);
        if (parsed.queue && Array.isArray(parsed.queue)) {
          const age = Date.now() - parsed.savedAt;
          if (age < MAX_BACKUP_AGE) {
            setState(prev => ({
              ...prev,
              recoveredFromBackup: true,
            }));
            queueRef.current = parsed.queue;
            return parsed.queue;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('فشل تحميل الطابور:', error);
      return null;
    }
  }, [enabled]);

  // ═══════════════════════════════════════════════════════════════
  // 🔄 تحديث الطابور
  // ═══════════════════════════════════════════════════════════════
  const updateQueue = useCallback((queue: QueueItem[]) => {
    if (!enabled) return;
    
    queueRef.current = queue;
    hasUnsavedChangesRef.current = true;
    setState(prev => ({ ...prev, hasUnsavedChanges: true }));
    
    if (saveOnChange) {
      // إلغاء الحفظ المجدول السابق
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // جدولة الحفظ بعد تأخير قصير (debounce)
      saveTimeoutRef.current = setTimeout(() => {
        saveQueue(queue);
        // حفظ نسخة احتياطية كل 10 تغييرات
        if (Math.random() < 0.1) {
          saveQueue(queue, true);
        }
      }, 500);
    }
  }, [enabled, saveOnChange, saveQueue]);

  // ═══════════════════════════════════════════════════════════════
  // 🗑️ مسح الطابور المحفوظ
  // ═══════════════════════════════════════════════════════════════
  const clearSaved = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(BACKUP_KEY);
      queueRef.current = [];
      hasUnsavedChangesRef.current = false;
      setState({
        lastSaved: null,
        hasUnsavedChanges: false,
        recoveredFromBackup: false,
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // 📊 الحصول على إحصائيات التخزين
  // ═══════════════════════════════════════════════════════════════
  const getStorageStats = useCallback(() => {
    try {
      const mainData = localStorage.getItem(STORAGE_KEY);
      const backupData = localStorage.getItem(BACKUP_KEY);
      
      return {
        mainSize: mainData ? new Blob([mainData]).size : 0,
        backupSize: backupData ? new Blob([backupData]).size : 0,
        totalSize: (mainData ? new Blob([mainData]).size : 0) + 
                   (backupData ? new Blob([backupData]).size : 0),
        itemCount: queueRef.current.length,
      };
    } catch {
      return {
        mainSize: 0,
        backupSize: 0,
        totalSize: 0,
        itemCount: 0,
      };
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // ⏰ الحفظ التلقائي الدوري
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!enabled || !autoSaveInterval) return;
    
    const interval = setInterval(() => {
      if (hasUnsavedChangesRef.current && queueRef.current.length > 0) {
        saveQueue(queueRef.current);
      }
    }, autoSaveInterval);
    
    return () => clearInterval(interval);
  }, [enabled, autoSaveInterval, saveQueue]);

  // ═══════════════════════════════════════════════════════════════
  // 🚪 الحفظ عند إغلاق الصفحة
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!enabled) return;
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.hasUnsavedChanges && queueRef.current.length > 0) {
        saveQueue(queueRef.current);
        saveQueue(queueRef.current, true); // نسخة احتياطية
        
        // تحذير المستخدم إذا كانت هناك رسائل معلقة
        const pendingCount = queueRef.current.filter(
          q => q.status === 'pending' || q.status === 'sending'
        ).length;
        
        if (pendingCount > 0) {
          e.preventDefault();
          e.returnValue = `لديك ${pendingCount} رسائل لم تُرسل بعد. هل أنت متأكد من الخروج؟`;
          return e.returnValue;
        }
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled, state.hasUnsavedChanges, saveQueue]);

  // تنظيف عند الإلغاء
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    ...state,
    saveQueue,
    loadQueue,
    updateQueue,
    clearSaved,
    getStorageStats,
    currentQueue: queueRef.current,
  };
}

// ═══════════════════════════════════════════════════════════════
// 🔧 دوال مساعدة
// ═══════════════════════════════════════════════════════════════

export const formatStorageSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default useQueuePersistence;
