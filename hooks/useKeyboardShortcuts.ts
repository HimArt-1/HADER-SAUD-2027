import { useEffect, useCallback, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════
// ⌨️ Keyboard Shortcuts Hook
// اختصارات لوحة المفاتيح لتسريع العمل
// ═══════════════════════════════════════════════════════════════

export interface KeyboardShortcut {
  /** المفتاح الرئيسي */
  key: string;
  /** مفتاح Ctrl */
  ctrl?: boolean;
  /** مفتاح Shift */
  shift?: boolean;
  /** مفتاح Alt */
  alt?: boolean;
  /** مفتاح Meta (Command في Mac) */
  meta?: boolean;
  /** الوصف */
  description: string;
  /** الدالة المنفذة */
  handler: () => void;
  /** تفعيل الاختصار (الافتراضي: true) */
  enabled?: boolean;
  /** منع السلوك الافتراضي (الافتراضي: true) */
  preventDefault?: boolean;
}

export interface UseKeyboardShortcutsOptions {
  /** قائمة الاختصارات */
  shortcuts: KeyboardShortcut[];
  /** تفعيل جميع الاختصارات (الافتراضي: true) */
  enabled?: boolean;
  /** تجاهل الضغطات داخل حقول الإدخال (الافتراضي: true) */
  ignoreInputs?: boolean;
}

const isInputElement = (element: EventTarget | null): boolean => {
  if (!element || !(element instanceof HTMLElement)) return false;
  
  const tagName = element.tagName.toLowerCase();
  const isEditable = element.isContentEditable;
  
  return tagName === 'input' || 
         tagName === 'textarea' || 
         tagName === 'select' || 
         isEditable;
};

export function useKeyboardShortcuts({
  shortcuts,
  enabled = true,
  ignoreInputs = true,
}: UseKeyboardShortcutsOptions) {
  // استخدام ref لتجنب إعادة إنشاء الـ handler
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;
    
    // تجاهل الضغطات داخل حقول الإدخال
    if (ignoreInputs && isInputElement(event.target)) {
      return;
    }

    const currentShortcuts = shortcutsRef.current;
    
    for (const shortcut of currentShortcuts) {
      // تخطي الاختصارات المعطلة
      if (shortcut.enabled === false) continue;
      
      const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatches = !!shortcut.ctrl === (event.ctrlKey || event.metaKey);
      const shiftMatches = !!shortcut.shift === event.shiftKey;
      const altMatches = !!shortcut.alt === event.altKey;
      
      if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
          event.stopPropagation();
        }
        
        shortcut.handler();
        return;
      }
    }
  }, [enabled, ignoreInputs]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // إرجاع الاختصارات للعرض في UI
  return {
    shortcuts: shortcuts.map(s => ({
      key: s.key,
      ctrl: s.ctrl,
      shift: s.shift,
      alt: s.alt,
      description: s.description,
      enabled: s.enabled !== false,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════
// 🎯 اختصارات WhatsApp Control الافتراضية
// ═══════════════════════════════════════════════════════════════

export interface WhatsAppShortcutHandlers {
  onSend?: () => void;
  onPause?: () => void;
  onClear?: () => void;
  onRefresh?: () => void;
  onToggleAutoPilot?: () => void;
  onFocusSearch?: () => void;
}

export function useWhatsAppShortcuts(handlers: WhatsAppShortcutHandlers, enabled = true) {
  const shortcuts: KeyboardShortcut[] = [
    {
      key: 's',
      ctrl: true,
      description: 'إرسال الرسائل المحددة',
      handler: () => handlers.onSend?.(),
      enabled: !!handlers.onSend,
    },
    {
      key: 'p',
      ctrl: true,
      description: 'إيقاف مؤقت / استكمال',
      handler: () => handlers.onPause?.(),
      enabled: !!handlers.onPause,
    },
    {
      key: 'Delete',
      ctrl: true,
      shift: true,
      description: 'حذف جميع الرسائل',
      handler: () => handlers.onClear?.(),
      enabled: !!handlers.onClear,
    },
    {
      key: 'r',
      ctrl: true,
      description: 'تحديث الطابور',
      handler: () => handlers.onRefresh?.(),
      enabled: !!handlers.onRefresh,
    },
    {
      key: 'a',
      ctrl: true,
      shift: true,
      description: 'تشغيل/إيقاف Auto-Pilot',
      handler: () => handlers.onToggleAutoPilot?.(),
      enabled: !!handlers.onToggleAutoPilot,
    },
    {
      key: '/',
      ctrl: true,
      description: 'التركيز على البحث',
      handler: () => handlers.onFocusSearch?.(),
      enabled: !!handlers.onFocusSearch,
    },
  ];

  return useKeyboardShortcuts({ shortcuts, enabled });
}

// ═══════════════════════════════════════════════════════════════
// 🖥️ مكون عرض الاختصارات
// ═══════════════════════════════════════════════════════════════

export const formatShortcut = (shortcut: {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): string => {
  const parts: string[] = [];
  
  if (shortcut.ctrl) parts.push('Ctrl');
  if (shortcut.shift) parts.push('Shift');
  if (shortcut.alt) parts.push('Alt');
  
  // تنسيق المفتاح
  let key = shortcut.key;
  if (key === ' ') key = 'Space';
  if (key === 'Delete') key = 'Del';
  if (key === 'Escape') key = 'Esc';
  if (key.length === 1) key = key.toUpperCase();
  
  parts.push(key);
  
  return parts.join('+');
};

export default useKeyboardShortcuts;
