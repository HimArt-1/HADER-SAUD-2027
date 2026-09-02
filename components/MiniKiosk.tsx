import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Monitor, X, RotateCw, RotateCcw, Scan, Loader2, CheckCircle, AlertCircle, Clock, Users, Maximize2 } from 'lucide-react';
import { Student } from '../types';

interface MiniKioskProps {
    isOpen: boolean;
    onClose: () => void;
    position: { x: number; y: number };
    size: { width: number; height: number };
    onPositionChange: (pos: { x: number; y: number }) => void;
    onSizeChange: (size: { width: number; height: number }) => void;
    rotation: 'none' | 'right' | 'left';
    onRotationChange: (rotation: 'none' | 'right' | 'left') => void;

    // Logic Props
    input: string;
    onInputChange: (val: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    loading: boolean;
    initStatus: 'loading' | 'ready' | 'error';
    result: {
        type: 'success' | 'error';
        message: string;
        student?: { id: string; name: string; class_name: string; section: string };
        isLate?: boolean;
        mode?: 'present' | 'late' | 'duplicate' | 'not_found' | 'closed';
    } | null;
    inputRef: React.RefObject<HTMLInputElement>;
}

export const MiniKiosk: React.FC<MiniKioskProps> = ({
    isOpen, onClose, position, size, onPositionChange, onSizeChange,
    rotation, onRotationChange,
    input, onInputChange, onSubmit, loading, initStatus, result, inputRef
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const [isResizing, setIsResizing] = useState(false);
    const [resizeDirection, setResizeDirection] = useState('');
    const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 });

    // ═══════════════════════════════════════════════════════════════
    // 🖱️ Drag Logic
    // ═══════════════════════════════════════════════════════════════
    const handleDragStart = (e: React.MouseEvent) => {
        if (headerRef.current && headerRef.current.contains(e.target as Node)) {
            setIsDragging(true);
            setDragStart({
                x: e.clientX - position.x,
                y: e.clientY - position.y
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // 📐 Resize Logic
    // ═══════════════════════════════════════════════════════════════
    const handleResizeStart = (e: React.MouseEvent, direction: string) => {
        e.stopPropagation();
        setIsResizing(true);
        setResizeDirection(direction);
        setResizeStart({
            x: e.clientX,
            y: e.clientY,
            width: size.width,
            height: size.height,
            left: position.x,
            top: position.y
        });
    };

    // ═══════════════════════════════════════════════════════════════
    // 🔄 Global Mouse Listeners (Drag & Resize)
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (!isOpen) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                // Dragging
                const newX = Math.max(0, Math.min(e.clientX - dragStart.x, window.innerWidth - size.width));
                const newY = Math.max(0, Math.min(e.clientY - dragStart.y, window.innerHeight - size.height));
                onPositionChange({ x: newX, y: newY });
            } else if (isResizing) {
                // Resizing
                const deltaX = e.clientX - resizeStart.x;
                const deltaY = e.clientY - resizeStart.y;

                const minWidth = 300;
                const minHeight = 400;
                const maxWidth = window.innerWidth - 20;

                let newWidth = resizeStart.width;
                let newHeight = resizeStart.height;
                let newX = resizeStart.left;
                let newY = resizeStart.top;

                if (resizeDirection.includes('e')) newWidth = Math.max(minWidth, Math.min(resizeStart.width + deltaX, maxWidth - resizeStart.left));
                if (resizeDirection.includes('w')) {
                    const widthChange = -deltaX;
                    newWidth = Math.max(minWidth, Math.min(resizeStart.width + widthChange, resizeStart.left + resizeStart.width - 20));
                    newX = Math.max(20, Math.min(resizeStart.left + deltaX, resizeStart.left + resizeStart.width - minWidth));
                }
                if (resizeDirection.includes('s')) newHeight = Math.max(minHeight, Math.min(resizeStart.height + deltaY, window.innerHeight - resizeStart.top));
                if (resizeDirection.includes('n')) {
                    const heightChange = -deltaY;
                    newHeight = Math.max(minHeight, Math.min(resizeStart.height + heightChange, resizeStart.top + resizeStart.height - 20));
                    newY = Math.max(20, Math.min(resizeStart.top + deltaY, resizeStart.top + resizeStart.height - minHeight));
                }

                onSizeChange({ width: newWidth, height: newHeight });
                onPositionChange({ x: newX, y: newY });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
            setResizeDirection('');
        };

        if (isDragging || isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, isResizing, dragStart, resizeStart, onPositionChange, onSizeChange, size, isOpen]);

    // ═══════════════════════════════════════════════════════════════
    // 🔄 Rotation & Scaling Effect
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (!isOpen) return;

        if (contentRef.current && containerRef.current) {
            const content = contentRef.current;
            content.classList.remove('mini-kiosk-rotate-none', 'mini-kiosk-rotate-right', 'mini-kiosk-rotate-left');
            content.classList.add(`mini-kiosk-rotate-${rotation}`);
        }
    }, [rotation, isOpen]);

    if (!isOpen) return null;


    return (
        <div
            ref={containerRef}
            className={`fixed rounded-2xl border backdrop-blur-xl overflow-hidden flex flex-col mini-kiosk-container
        ${isDragging ? 'cursor-grabbing' : ''}`}
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${size.width}px`,
                height: `${size.height}px`,
                // Adaptive Background for Light/Dark Mode
                // Using CSS variables via tailwind helper classes would be better, but inline styles override them often.
                // We'll use a dynamic class approach below, but direct styles for position.
                zIndex: 99999,
                willChange: 'transform, left, top, width, height'
            }}
        >
            {/* 
         The background logic needs to be handled via classes to support Light Mode properly. 
         We wrap the content in absolute divs to manage the background.
      */}
            <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 transition-colors duration-300" />
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-secondary-500/5 pointer-events-none" />

            {/* ✋ Header - Draggable & Premium Control Panel */}
            <div
                ref={headerRef}
                onMouseDown={handleDragStart}
                className="relative z-10 flex items-center justify-between px-3 py-2.5 border-b cursor-move select-none transition-colors duration-300
          bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-white/10 backdrop-blur-md group"
            >
                {/* Drag Handle Pattern Overlay */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-10 pointer-events-none transition-opacity"
                    style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '8px 8px' }}
                />

                <div className="flex items-center gap-3 relative z-10">
                    <div className="relative">
                        <div className={`absolute inset-0 rounded-lg blur opacity-50 ${initStatus === 'ready' ? 'bg-primary-500' : 'bg-slate-500'}`} />
                        <div className="bg-gradient-to-br from-white to-slate-100 dark:from-slate-800 dark:to-slate-900 p-1.5 rounded-lg border border-slate-200 dark:border-white/10 relative shadow-sm">
                            <Monitor className={`w-4 h-4 ${initStatus === 'ready' ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}`} />
                        </div>
                        {/* Status Dot */}
                        {initStatus === 'ready' && (
                            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900 shadow-sm" />
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-tight">
                            ميني-كشك
                        </h3>
                        <p className="text-[10px] text-slate-400 font-medium">
                            {rotation !== 'none' ? 'وضع التابلت' : 'الوضع العادي'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 relative z-10">
                    {/* Segmented Rotation Controls */}
                    <div className="flex bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-white/5">
                        {[
                            { r: 'none', icon: Monitor, label: 'عادي' },
                            { r: 'right', icon: RotateCw, label: 'يمين' },
                            { r: 'left', icon: RotateCcw, label: 'يسار' }
                        ].map((opt) => (
                            <button
                                key={opt.r}
                                onClick={(e) => { e.stopPropagation(); onRotationChange(opt.r as any); }}
                                className={`p-1.5 rounded-md transition-all relative group/btn ${rotation === opt.r
                                    ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5'
                                    }`}
                                title={opt.label}
                            >
                                <opt.icon className="w-3.5 h-3.5" />
                            </button>
                        ))}
                    </div>

                    <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1" />

                    {/* Window Controls */}
                    <div className="flex gap-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const isMaximized = size.width > 500 || size.height > 600;
                                if (isMaximized) {
                                    onSizeChange({ width: 400, height: 500 }); // Restore
                                    onPositionChange({ x: 50, y: 50 });
                                } else {
                                    onSizeChange({ width: 800, height: 600 }); // Maximize
                                    onPositionChange({ x: window.innerWidth / 2 - 400, y: window.innerHeight / 2 - 300 });
                                }
                            }}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                            title="تغيير الحجم"
                        >
                            <Maximize2 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onClose(); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors"
                            title="إغلاق"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* 📦 Content - Rotatable Container */}
            <div
                ref={contentRef}
                className="relative flex-1 bg-slate-50/50 dark:bg-slate-950/30 overflow-hidden transition-all duration-500 ease-in-out"
            >
                <div
                    className="w-full h-full flex flex-col justify-center items-center p-6 relative"
                    style={{
                        transform: rotation !== 'none' ? 'scale(0.9) rotate(var(--rotation-deg, 0deg))' : 'none',
                        // Force hardware acceleration
                        backfaceVisibility: 'hidden'
                    }}
                >
                    {/* Loading State */}
                    {initStatus === 'loading' && (
                        <div className="text-center space-y-4">
                            <Loader2 className="w-10 h-10 text-primary-500 animate-spin mx-auto" />
                            <p className="text-slate-500 dark:text-slate-400 font-medium">جاري تحضير الكشك...</p>
                        </div>
                    )}

                    {/* Error State */}
                    {initStatus === 'error' && (
                        <div className="text-center space-y-4 text-red-500">
                            <AlertCircle className="w-12 h-12 mx-auto" />
                            <p className="font-bold">حدث خطأ في التهيئة</p>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm hover:bg-red-100 transition"
                            >
                                إغلاق والمحاولة مرة أخرى
                            </button>
                        </div>
                    )}

                    {/* Ready State */}
                    {initStatus === 'ready' && (
                        <>
                            {/* 🟢 Input Card */}
                            {!result && (
                                <div className="w-full max-w-sm animate-fade-in-up">
                                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-xl border border-slate-200 dark:border-slate-800 text-center relative overflow-hidden group">
                                        {/* decorative scan line */}
                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent animate-scan" />

                                        <div className="w-20 h-20 bg-primary-50 dark:bg-primary-900/20 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                                            <Scan className="w-10 h-10 text-primary-500 dark:text-primary-400" />
                                        </div>

                                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
                                            {loading ? 'جاري التحضير...' : 'قارئ الباركود جاهز'}
                                        </h2>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                                            مرر البطاقة الآن لتسجيل الحضور
                                        </p>

                                        <form onSubmit={onSubmit} className="relative">
                                            <input
                                                ref={inputRef}
                                                type="text"
                                                value={input}
                                                onChange={(e) => onInputChange(e.target.value)}
                                                className="w-full bg-slate-100 dark:bg-slate-800 border-2 border-transparent focus:border-primary-500 rounded-xl px-4 py-3 text-center font-mono text-lg outline-none transition-all placeholder:text-transparent"
                                                placeholder="Scan ID..."
                                                autoFocus
                                                disabled={loading}
                                                onBlur={(e) => !loading && setTimeout(() => e.target.focus(), 100)}
                                            />
                                            {/* Fake cursor effect */}
                                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                                {!input && <span className="w-0.5 h-6 bg-primary-500 animate-pulse" />}
                                            </div>
                                        </form>
                                    </div>
                                </div>
                            )}

                            {/* 🔵 Result Card */}
                            {result && (
                                <div className="w-full max-w-sm animate-scale-in">
                                    <div className={`
                    rounded-3xl p-8 border text-center shadow-2xl relative overflow-hidden
                    ${result.type === 'success'
                                            ? result.isLate
                                                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50'
                                                : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50'
                                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50'
                                        }
                  `}>
                                        {/* Icon */}
                                        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner ${result.type === 'success'
                                            ? result.isLate ? 'bg-amber-100 dark:bg-amber-800/40 text-amber-600' : 'bg-emerald-100 dark:bg-emerald-800/40 text-emerald-600'
                                            : 'bg-red-100 dark:bg-red-800/40 text-red-600'
                                            }`}>
                                            {result.type === 'success'
                                                ? result.isLate ? <Clock className="w-10 h-10" /> : <CheckCircle className="w-10 h-10 warning-bounce" />
                                                : <AlertCircle className="w-10 h-10 shake" />
                                            }
                                        </div>

                                        {/* Content */}
                                        {result.type === 'success' && result.student ? (
                                            <div className="space-y-2">
                                                <h2 className="text-3xl font-bold text-slate-800 dark:text-white font-serif">
                                                    {result.student.name}
                                                </h2>
                                                <div className="flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300 font-medium">
                                                    <Users className="w-4 h-4" />
                                                    <span>{result.student.class_name} - {result.student.section}</span>
                                                </div>

                                                <div className={`mt-6 inline-flex items-center px-4 py-2 rounded-full font-bold text-sm ${result.isLate
                                                    ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                                                    : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                                    }`}>
                                                    {result.message}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                                                    {result.message}
                                                </h2>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* 📐 Resize Handles */}
            <div className="absolute inset-0 pointer-events-none z-50">
                <div onMouseDown={(e) => handleResizeStart(e, 'n')} className="absolute top-0 left-2 right-2 h-1 cursor-ns-resize pointer-events-auto hover:bg-primary-500/50 transition-colors" />
                <div onMouseDown={(e) => handleResizeStart(e, 's')} className="absolute bottom-0 left-2 right-2 h-1 cursor-ns-resize pointer-events-auto hover:bg-primary-500/50 transition-colors" />
                <div onMouseDown={(e) => handleResizeStart(e, 'w')} className="absolute left-0 top-2 bottom-2 w-1 cursor-ew-resize pointer-events-auto hover:bg-primary-500/50 transition-colors" />
                <div onMouseDown={(e) => handleResizeStart(e, 'e')} className="absolute right-0 top-2 bottom-2 w-1 cursor-ew-resize pointer-events-auto hover:bg-primary-500/50 transition-colors" />

                {/* Corners */}
                <div onMouseDown={(e) => handleResizeStart(e, 'nw')} className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize pointer-events-auto hover:bg-primary-500/50 rounded-br-lg" />
                <div onMouseDown={(e) => handleResizeStart(e, 'ne')} className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize pointer-events-auto hover:bg-primary-500/50 rounded-bl-lg" />
                <div onMouseDown={(e) => handleResizeStart(e, 'sw')} className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize pointer-events-auto hover:bg-primary-500/50 rounded-tr-lg" />
                <div onMouseDown={(e) => handleResizeStart(e, 'se')} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize pointer-events-auto hover:bg-primary-500/50 rounded-tl-lg bg-primary-500/20" />
            </div>
        </div>
    );
};
