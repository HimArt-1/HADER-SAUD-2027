// =============================================================================
// نظام حاضر (Hader) - Notification Settings Panel
// =============================================================================
// لوحة إعدادات الإشعارات التلقائية للحضور

import React, { useState, useEffect } from 'react';
import { Bell, Clock, Users, Shield, Play, Pause, RefreshCw, CheckCircle, AlertCircle, Settings } from 'lucide-react';
import {
    attendanceNotificationService,
    AttendanceNotificationConfig,
    DEFAULT_NOTIFICATION_CONFIG
} from '../../services/attendanceNotificationService';

const NotificationSettingsPanel: React.FC = () => {
    const [config, setConfig] = useState<AttendanceNotificationConfig>(DEFAULT_NOTIFICATION_CONFIG);
    const [isRunning, setIsRunning] = useState(false);
    const [lastCheck, setLastCheck] = useState<string | null>(null);
    const [todaySentCount, setTodaySentCount] = useState(0);
    const [isChecking, setIsChecking] = useState(false);
    const [checkResult, setCheckResult] = useState<{ late: number; absent: number } | null>(null);

    // تحميل الإعدادات
    useEffect(() => {
        setConfig(attendanceNotificationService.getConfig());
        setIsRunning(attendanceNotificationService.isActive());
        setLastCheck(attendanceNotificationService.getLastCheckTime());
        setTodaySentCount(attendanceNotificationService.getTodaySentCount());
    }, []);

    // حفظ الإعدادات
    const handleSave = (updates: Partial<AttendanceNotificationConfig>) => {
        const newConfig = { ...config, ...updates };
        setConfig(newConfig);
        attendanceNotificationService.saveConfig(updates);
    };

    // تشغيل/إيقاف الخدمة
    const toggleService = () => {
        if (isRunning) {
            attendanceNotificationService.stop();
        } else {
            attendanceNotificationService.start();
        }
        setIsRunning(!isRunning);
    };

    // فحص يدوي
    const handleManualCheck = async () => {
        setIsChecking(true);
        setCheckResult(null);
        try {
            const result = await attendanceNotificationService.triggerCheck();
            setCheckResult(result);
            setLastCheck(attendanceNotificationService.getLastCheckTime());
            setTodaySentCount(attendanceNotificationService.getTodaySentCount());
        } catch (error) {
            console.error('Manual check failed:', error);
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/55 shadow-[0_18px_65px_-55px_rgba(245,158,11,0.5)] backdrop-blur-xl">
            {/* Header */}
            <div className="border-b border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10">
                            <Bell className="w-6 h-6 text-amber-400" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">إشعارات الحضور التلقائية</h3>
                            <p className="text-sm text-gray-400">إرسال تنبيهات للتأخر والغياب تلقائياً</p>
                        </div>
                    </div>

                    {/* Service Status */}
                    <div className="flex items-center gap-3">
                        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
                            isRunning
                                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                : 'bg-gray-500/10 border-gray-500/30 text-gray-400'
                        }`}>
                            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                            {isRunning ? 'نشط' : 'متوقف'}
                        </div>
                        <button
                            onClick={toggleService}
                            className={`p-3 rounded-xl transition-all ${
                                isRunning
                                    ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30'
                                    : 'bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/30'
                            }`}
                            title={isRunning ? 'إيقاف الخدمة' : 'تشغيل الخدمة'}
                        >
                            {isRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Settings */}
            <div className="p-6 space-y-6">
                {/* Main Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center gap-3">
                        <Settings className="w-5 h-5 text-gray-400" />
                        <div>
                            <p className="font-medium text-white">تفعيل الإشعارات التلقائية</p>
                            <p className="text-xs text-gray-500">إرسال إشعارات عند التأخر أو الغياب</p>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.enabled}
                            onChange={(e) => handleSave({ enabled: e.target.checked })}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                    </label>
                </div>

                {/* Notification Types */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Late Notifications */}
                    <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/20">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Clock className="w-5 h-5 text-orange-400" />
                                <span className="font-medium text-white">إشعارات التأخر</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.notifyOnLate}
                                    onChange={(e) => handleSave({ notifyOnLate: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-orange-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                            </label>
                        </div>
                        <p className="text-xs text-gray-400">إرسال تنبيه عند تسجيل حضور متأخر</p>
                    </div>

                    {/* Absent Notifications */}
                    <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <AlertCircle className="w-5 h-5 text-red-400" />
                                <span className="font-medium text-white">إشعارات الغياب</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.notifyOnAbsent}
                                    onChange={(e) => handleSave({ notifyOnAbsent: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-red-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                            </label>
                        </div>
                        <p className="text-xs text-gray-400">إرسال تنبيه للطلاب الغائبين</p>
                    </div>
                </div>

                {/* Target Audiences */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Guardians */}
                    <div className="p-4 rounded-xl bg-secondary-500/5 border border-secondary-500/20">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-secondary-400" />
                                <span className="font-medium text-white">إشعار أولياء الأمور</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.notifyGuardians}
                                    onChange={(e) => handleSave({ notifyGuardians: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-secondary-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                            </label>
                        </div>
                        <p className="text-xs text-gray-400">إرسال إشعار لولي أمر الطالب</p>
                    </div>

                    {/* Supervisors */}
                    <div className="p-4 rounded-xl bg-secondary-500/5 border border-secondary-500/20">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Shield className="w-5 h-5 text-secondary-400" />
                                <span className="font-medium text-white">إشعار المشرفين</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.notifySupervisors}
                                    onChange={(e) => handleSave({ notifySupervisors: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-secondary-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                            </label>
                        </div>
                        <p className="text-xs text-gray-400">إرسال إشعار للمشرفين والإدارة</p>
                    </div>
                </div>

                {/* Timing Settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            فترة السماح للغياب (بالدقائق)
                        </label>
                        <input
                            type="number"
                            min="5"
                            max="120"
                            value={config.lateThresholdMinutes}
                            onChange={(e) => handleSave({ lateThresholdMinutes: parseInt(e.target.value) || 15 })}
                            className="w-full px-4 py-2 rounded-lg bg-black/20 border border-white/10 text-white focus:border-amber-500/50 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">إرسال إشعار الغياب بعد هذه الفترة من وقت الطابور</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            فترة الفحص (بالدقائق)
                        </label>
                        <input
                            type="number"
                            min="5"
                            max="60"
                            value={config.checkIntervalMinutes}
                            onChange={(e) => handleSave({ checkIntervalMinutes: parseInt(e.target.value) || 30 })}
                            className="w-full px-4 py-2 rounded-lg bg-black/20 border border-white/10 text-white focus:border-amber-500/50 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">فحص الحضور كل هذه الفترة</p>
                    </div>
                </div>

                {/* Status & Actions */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            <span>آخر فحص: {lastCheck ? new Date(lastCheck).toLocaleString('ar-SA') : 'لم يتم'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Bell className="w-4 h-4" />
                            <span>إشعارات اليوم: {todaySentCount}</span>
                        </div>
                    </div>

                    <button
                        onClick={handleManualCheck}
                        disabled={isChecking}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-all disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
                        {isChecking ? 'جاري الفحص...' : 'فحص الآن'}
                    </button>
                </div>

                {/* Check Result */}
                {checkResult && (
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-green-500/10 border border-green-500/20 animate-fade-in">
                        <CheckCircle className="w-5 h-5 text-green-400" />
                        <span className="text-green-300">
                            تم الفحص: {checkResult.late} متأخر، {checkResult.absent} غائب
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NotificationSettingsPanel;
