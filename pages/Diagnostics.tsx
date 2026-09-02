import React, { useEffect, useState } from 'react';
import { syncService } from '../services/syncService';
import { db } from '../services/db';
import { localDb, getPendingSyncEntries } from '../services/localDb';
import { RefreshCw, Database, Server, Wifi, AlertTriangle, Trash2 } from 'lucide-react';

const Diagnostics: React.FC = () => {
    const [diagnostics, setDiagnostics] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [detailedQueue, setDetailedQueue] = useState<any[]>([]);
    const [showQueue, setShowQueue] = useState(false);

    const fetchDiagnostics = async () => {
        setLoading(true);
        try {
            const diag = await syncService.getDiagnostics();
            setDiagnostics(diag);

            // Get detailed queue for inspection
            const queue = await getPendingSyncEntries({ includeBlocked: true });
            setDetailedQueue(queue);
        } catch (error) {
            console.error('Failed to fetch diagnostics:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDiagnostics();
        const interval = setInterval(fetchDiagnostics, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleForceSync = async () => {
        setSyncing(true);
        try {
            await syncService.syncNow('bidirectional');
            await fetchDiagnostics(); // Refresh immediately after
        } catch (error) {
            console.error('Force sync failed:', error);
            alert('Sync Failed: ' + (error as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const handleClearQueue = async () => {
        if (!window.confirm('⚠️ DANGER: This will delete all pending changes that havent reached the server yet. Are you sure?')) {
            return;
        }

        try {
            await localDb.sync_queue.clear();
            await fetchDiagnostics();
            alert('Queue cleared.');
        } catch (error) {
            console.error('Failed to clear queue:', error);
        }
    };

    if (loading && !diagnostics) {
        return <div className="p-8 text-center text-white">Loading diagnostics...</div>;
    }

    return (
        <div className="min-h-screen bg-slate-900 text-white p-6">
            <div className="max-w-4xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <AlertTriangle className="text-yellow-400" />
                            System Diagnostics
                        </h1>
                        <p className="text-slate-400">Sync Status & Local Database Health</p>
                    </div>
                    <button
                        onClick={fetchDiagnostics}
                        className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition"
                    >
                        <RefreshCw className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Status Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Network Status */}
                    <div className={`p-4 rounded-xl border ${diagnostics?.isOnline ? 'bg-green-900/20 border-green-500/50' : 'bg-red-900/20 border-red-500/50'}`}>
                        <div className="flex items-center gap-3 mb-2">
                            <Wifi className={diagnostics?.isOnline ? 'text-green-400' : 'text-red-400'} size={24} />
                            <h3 className="font-semibold">Network</h3>
                        </div>
                        <p className={`text-xl font-bold ${diagnostics?.isOnline ? 'text-green-400' : 'text-red-400'}`}>
                            {diagnostics?.isOnline ? 'Online' : 'Offline'}
                        </p>
                    </div>

                    {/* Sync Queue */}
                    <div className={`p-4 rounded-xl border ${(diagnostics?.queueSize || 0) + (diagnostics?.blockedQueueSize || 0) > 0 ? 'bg-yellow-900/20 border-yellow-500/50' : 'bg-slate-800 border-slate-700'}`}>
                        <div className="flex items-center gap-3 mb-2">
                            <Database className={(diagnostics?.queueSize || 0) + (diagnostics?.blockedQueueSize || 0) > 0 ? 'text-yellow-400' : 'text-slate-400'} size={24} />
                            <h3 className="font-semibold">Sync Queue</h3>
                        </div>
                        <p className="text-2xl font-bold">
                            {diagnostics?.queueSize} <span className="text-sm font-normal text-slate-400">pending items</span>
                        </p>
                        {(diagnostics?.blockedQueueSize || 0) > 0 && (
                            <p className="mt-1 text-xs text-amber-300">{diagnostics.blockedQueueSize} blocked for review</p>
                        )}
                    </div>

                    {/* Cloud Status */}
                    <div className={`p-4 rounded-xl border ${diagnostics?.supabaseConfigured ? 'bg-secondary-900/20 border-secondary-500/50' : 'bg-red-900/20 border-red-500/50'}`}>
                        <div className="flex items-center gap-3 mb-2">
                            <Server className={diagnostics?.supabaseConfigured ? 'text-secondary-400' : 'text-red-400'} size={24} />
                            <h3 className="font-semibold">Supabase</h3>
                        </div>
                        <p className="text-sm">
                            Last Sync: <span className="font-mono text-secondary-300">{diagnostics?.lastSync ? new Date(diagnostics.lastSync).toLocaleTimeString() : 'Never'}</span>
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-4">
                    <button
                        onClick={handleForceSync}
                        disabled={syncing || !diagnostics?.isOnline}
                        className={`flex-1 py-3 px-6 rounded-lg font-bold flex items-center justify-center gap-2 transition
              ${syncing
                                ? 'bg-slate-700 cursor-wait'
                                : 'bg-secondary-600 hover:bg-secondary-500 shadow-lg shadow-secondary-900/50'}`}
                    >
                        <RefreshCw className={syncing ? 'animate-spin' : ''} />
                        {syncing ? 'Syncing...' : 'Force Sync Now'}
                    </button>

                    <button
                        onClick={handleClearQueue}
                        disabled={(diagnostics?.queueSize || 0) + (diagnostics?.blockedQueueSize || 0) === 0}
                        className="px-6 py-3 bg-red-900/30 text-red-400 border border-red-900/50 rounded-lg hover:bg-red-900/50 transition flex items-center gap-2"
                    >
                        <Trash2 />
                        Clear Queue
                    </button>
                </div>

                {/* Sync Telemetry */}
                {diagnostics?.lastSyncSummary && (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 space-y-3">
                        <h3 className="font-bold text-slate-200">Last Sync Telemetry</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                            <div className="bg-slate-900/60 rounded-lg p-3">
                                <p className="text-slate-400">Duration</p>
                                <p className="font-mono text-primary-300">{diagnostics.lastSyncSummary.duration_ms ?? 0} ms</p>
                            </div>
                            <div className="bg-slate-900/60 rounded-lg p-3">
                                <p className="text-slate-400">Queue Start</p>
                                <p className="font-mono text-yellow-300">{diagnostics.lastSyncSummary.queue_start ?? 0}</p>
                            </div>
                            <div className="bg-slate-900/60 rounded-lg p-3">
                                <p className="text-slate-400">Queue End</p>
                                <p className="font-mono text-green-300">{diagnostics.lastSyncSummary.queue_end ?? 0}</p>
                            </div>
                            <div className="bg-slate-900/60 rounded-lg p-3">
                                <p className="text-slate-400">Errors</p>
                                <p className={`font-mono ${(diagnostics.lastSyncSummary.errors_count || 0) > 0 ? 'text-red-300' : 'text-green-300'}`}>
                                    {diagnostics.lastSyncSummary.errors_count ?? 0}
                                </p>
                            </div>
                        </div>
                        {diagnostics?.lastSyncWatermark && (
                            <p className="text-xs text-slate-400">
                                Watermark advance: <span className="font-mono text-slate-200">{diagnostics.lastSyncWatermark.advanced_ms ?? 'n/a'} ms</span>
                            </p>
                        )}
                    </div>
                )}

                {diagnostics?.lastPullTelemetry?.stale_tables?.length > 0 && (
                    <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-4">
                        <h3 className="font-bold text-red-300 mb-2">Stale Pull Warning</h3>
                        <p className="text-sm text-red-200">
                            بعض الجداول أعادت نافذة بيانات أقدم/مطابقة لعلامة المزامنة الأخيرة:
                        </p>
                        <p className="font-mono text-xs text-red-100 mt-2">
                            {diagnostics.lastPullTelemetry.stale_tables.join(', ')}
                        </p>
                    </div>
                )}

                {/* Detailed Queue View */}
                {diagnostics?.queueSize > 0 && (
                    <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
                        <div
                            className="p-4 bg-slate-800/50 border-b border-slate-700 flex justify-between items-center cursor-pointer hover:bg-slate-700/50"
                            onClick={() => setShowQueue(!showQueue)}
                        >
                            <h3 className="font-bold flex items-center gap-2">
                                <Database /> Pending Changes ({detailedQueue.length})
                            </h3>
                            <span className="text-sm text-slate-400">{showQueue ? 'Hide' : 'Show'}</span>
                        </div>

                        {showQueue && (
                            <div className="max-h-96 overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-900/50 text-slate-400">
                                        <tr>
                                            <th className="p-3">Table</th>
                                            <th className="p-3">Action</th>
                                            <th className="p-3">ID</th>
                                            <th className="p-3">State</th>
                                            <th className="p-3">Retries</th>
                                            <th className="p-3">Error</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailedQueue.map((item) => (
                                            <tr key={item.id} className="border-t border-slate-700 hover:bg-slate-700/30">
                                                <td className="p-3 font-mono text-secondary-300">{item.table}</td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold
                            ${item.operation === 'INSERT' ? 'bg-green-900/50 text-green-400' :
                                                            item.operation === 'UPDATE' ? 'bg-secondary-900/50 text-secondary-400' : 'bg-red-900/50 text-red-400'}`}>
                                                        {item.operation}
                                                    </span>
                                                </td>
                                                <td className="p-3 font-mono text-xs text-slate-400 truncate max-w-[100px]" title={item.payload?.id}>{item.payload?.id || '-'}</td>
                                                <td className="p-3">
                                                    {item.blocked_at ? (
                                                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-900/50 text-amber-300">BLOCKED</span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-200">PENDING</span>
                                                    )}
                                                </td>
                                                <td className="p-3">{item.retry_count || 0}</td>
                                                <td className="p-3 text-red-400 text-xs truncate max-w-[200px]" title={item.last_error}>
                                                    {item.last_error || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
};

export default Diagnostics;
