import React from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Send, Clock, AlertTriangle } from 'lucide-react';

interface StatsPanelProps {
    total: number;
    success: number;
    pending: number;
    failed: number;
}

const StatsPanel: React.FC<StatsPanelProps> = ({ total, success, pending, failed }) => {
    const data = [
        { name: 'تم الإرسال', value: success, color: '#22c55e' }, // Green
        { name: 'قيد الانتظار', value: pending, color: '#f59e0b' }, // Amber
        { name: 'فشل', value: failed, color: '#ef4444' } // Red
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Chart Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="col-span-1 glass-card p-6 rounded-3xl border border-white/10 relative overflow-hidden flex items-center justify-between"
            >
                <div className="absolute top-0 left-0 w-full h-full bg-blue-500/5 -z-10" />
                <div className="flex flex-col justify-center">
                    <h3 className="text-lg font-bold text-gray-300 mb-1">الحالة الآن</h3>
                    <p className="text-4xl font-black text-white">{total}</p>
                    <p className="text-xs text-gray-500">إجمالي الرسائل المستهدفة</p>
                </div>
                <div className="w-24 h-24">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                innerRadius={25}
                                outerRadius={40}
                                paddingAngle={5}
                                dataKey="value"
                                stroke="none"
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1f2937', borderRadius: '8px', border: 'none' }}
                                itemStyle={{ color: '#fff' }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </motion.div>

            {/* Counters */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="col-span-2 grid grid-cols-3 gap-4"
            >
                {/* Success */}
                <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden group">
                    <div className="absolute -right-6 -top-6 w-24 h-24 bg-green-500/20 rounded-full blur-2xl group-hover:bg-green-500/30 transition-all" />
                    <Send className="w-6 h-6 text-green-400 mb-2" />
                    <span className="text-2xl font-bold text-green-100">{success}</span>
                    <span className="text-xs text-green-300/70">تم الإرسال</span>
                </div>

                {/* Pending */}
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden group">
                    <div className="absolute -right-6 -top-6 w-24 h-24 bg-orange-500/20 rounded-full blur-2xl group-hover:bg-orange-500/30 transition-all" />
                    <Clock className="w-6 h-6 text-orange-400 mb-2" />
                    <span className="text-2xl font-bold text-orange-100">{pending}</span>
                    <span className="text-xs text-orange-300/70">قيد الانتظار</span>
                </div>

                {/* Failed */}
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden group">
                    <div className="absolute -right-6 -top-6 w-24 h-24 bg-red-500/20 rounded-full blur-2xl group-hover:bg-red-500/30 transition-all" />
                    <AlertTriangle className="w-6 h-6 text-red-400 mb-2" />
                    <span className="text-2xl font-bold text-red-100">{failed}</span>
                    <span className="text-xs text-red-300/70">فشل/خطأ</span>
                </div>
            </motion.div>
        </div>
    );
};

export default StatsPanel;
