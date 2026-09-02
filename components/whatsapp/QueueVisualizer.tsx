import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, CheckCircle, Clock, Smartphone } from 'lucide-react';

interface QueueItem {
    id: string;
    studentName: string;
    status: 'pending' | 'sending' | 'sent' | 'failed';
    timestamp: number;
    statusLabel?: string;
}

interface QueueVisualizerProps {
    queue: QueueItem[];
    processingId?: string;
    onRemove?: (id: string) => void;
}

const QueueVisualizer: React.FC<QueueVisualizerProps> = ({ queue, processingId, onRemove }) => {
    // Show only last 5 completed and all pending
    const displayQueue = queue.slice(0, 8); // Simplified for demo

    return (
        <div className="glass-card p-6 rounded-3xl border border-white/10 min-h-[120px] relative overflow-hidden flex items-center gap-4">
            <div className="absolute top-0 right-0 px-4 py-2 bg-black/20 text-xs text-gray-400 rounded-bl-xl border-b border-l border-white/5">
                شريط المعالجة الحي
            </div>

            <div className="flex-1 flex items-center gap-4 overflow-x-auto p-4 custom-scrollbar">
                <AnimatePresence mode='popLayout'>
                    {displayQueue.map((item) => (
                        <motion.div
                            key={item.id}
                            layout
                            initial={{ opacity: 0, scale: 0.8, x: -50 }}
                            animate={{
                                opacity: 1,
                                scale: item.id === processingId ? 1.1 : 1,
                                x: 0,
                                borderColor: item.id === processingId ? '#3b82f6' : 'rgba(255,255,255,0.1)'
                            }}
                            exit={{ opacity: 0, scale: 0.5, y: 50 }}
                            className={`flex flex-col items-center justify-center min-w-[100px] h-[100px] rounded-2xl border bg-black/40 backdrop-blur-md relative
                                ${item.status === 'sent' ? 'border-green-500/30 bg-green-500/5' : ''}
                                ${item.status === 'failed' ? 'border-red-500/30 bg-red-500/5' : ''}
                                ${item.id === processingId ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'border-white/10'}
                            `}
                        >
                            {/* Icon based on status */}
                            <div className="mb-1">
                                {item.status === 'sent' && <CheckCircle className="w-5 h-5 text-green-400" />}
                                {item.status === 'failed' && <Smartphone className="w-5 h-5 text-red-400" />}
                                {(item.status === 'pending' || item.status === 'sending') && <MessageSquare className={`w-5 h-5 ${item.id === processingId ? 'text-blue-400' : 'text-gray-500'}`} />}
                            </div>

                            <div className="text-[10px] font-bold text-gray-200 text-center px-2 truncate w-full mb-1">
                                {item.studentName.split(' ').slice(0, 2).join(' ')}
                            </div>

                            {item.statusLabel && (
                                <div className={`text-[9px] px-2 py-0.5 rounded-full ${item.statusLabel === 'غياب' || item.statusLabel === 'غائب' ? 'bg-red-500/20 text-red-300' :
                                        item.statusLabel.includes('تأخر') ? 'bg-orange-500/20 text-orange-300' : 'bg-blue-500/20 text-blue-300'
                                    }`}>
                                    {item.statusLabel}
                                </div>
                            )}

                            {/* Delete Button */}
                            {onRemove && item.status === 'pending' && (
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => onRemove(item.id)}
                                    className="absolute top-1 left-1 p-1 rounded-full bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </motion.button>
                            )}

                            {/* Connecting Line (Visual Decor) */}
                            {item.id === processingId && (
                                <motion.div
                                    layoutId="active-indicator"
                                    className="absolute -bottom-2 w-12 h-1 bg-blue-500 rounded-full blur-[2px]"
                                />
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>

                {queue.length === 0 && (
                    <div className="w-full text-center text-gray-500 py-4 flex flex-col items-center">
                        <Clock className="w-8 h-8 mb-2 opacity-20" />
                        <span className="text-sm opacity-50">طابور الانتظار فارغ</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default QueueVisualizer;
