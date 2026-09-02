import React, { useState } from 'react';
import { WhatsAppTemplate } from '../../types';
import { Plus, Edit2, Trash2, Check, X, FileText, Send, Save } from 'lucide-react';

interface TemplateManagerProps {
    templates: WhatsAppTemplate[];
    onUpdate: (templates: WhatsAppTemplate[]) => void;
}

export const TemplateManager: React.FC<TemplateManagerProps> = ({ templates, onUpdate }) => {
    const [isEditing, setIsEditing] = useState<string | null>(null); // ID of template being edited
    const [editForm, setEditForm] = useState<WhatsAppTemplate | null>(null);

    const handleEdit = (tmpl: WhatsAppTemplate) => {
        setIsEditing(tmpl.id);
        setEditForm({ ...tmpl });
    };

    const handleCreate = () => {
        const newTemplate: WhatsAppTemplate = {
            id: crypto.randomUUID(),
            name: 'قالب جديد',
            content: '',
            category: 'general',
            is_default: false
        };
        setIsEditing(newTemplate.id);
        setEditForm(newTemplate);
    };

    const handleSave = () => {
        if (!editForm) return;

        const existingIndex = templates.findIndex(t => t.id === editForm.id);
        let updatedTemplates = [...templates];

        if (existingIndex >= 0) {
            updatedTemplates[existingIndex] = editForm;
        } else {
            updatedTemplates.push(editForm);
        }

        onUpdate(updatedTemplates);
        setIsEditing(null);
        setEditForm(null);
    };

    const handleDelete = (id: string) => {
        if (confirm('هل أنت متأكد من حذف هذا القالب؟')) {
            onUpdate(templates.filter(t => t.id !== id));
        }
    };

    const categories = {
        'general': 'عام',
        'absence': 'غياب',
        'late': 'تأخر',
        'behavior': 'سلوك'
    };

    return (
        <div className="space-y-6 animate-fade-in text-right">
            <div className="flex justify-between items-center mb-6">
                <button
                    onClick={handleCreate}
                    className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-2 rounded-xl hover:shadow-lg hover:shadow-green-500/20 transition-all font-bold"
                >
                    <Plus className="w-5 h-5" />
                    <span>إضافة قالب جديد</span>
                </button>
                <div className="text-gray-400 text-sm">
                    {templates.length} قوالب محفوظة
                </div>
            </div>

            {/* Editor Mode */}
            {isEditing && editForm && (
                <div className="glass-card p-6 rounded-2xl border border-white/10 mb-8 bg-white/5 relative">
                    <button
                        onClick={() => setIsEditing(null)}
                        className="absolute left-4 top-4 text-gray-500 hover:text-white"
                    >
                        <X className="w-6 h-6" />
                    </button>

                    <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                        <Edit2 className="w-5 h-5 text-blue-400" />
                        {templates.some(t => t.id === editForm.id) ? 'تعديل القالب' : 'إنشاء قالب جديد'}
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">اسم القالب</label>
                            <input
                                type="text"
                                value={editForm.name}
                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-blue-500/50 outline-none"
                                placeholder="مثلاً: تنبيه الغياب الأول"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">الفئة</label>
                            <select
                                value={editForm.category}
                                onChange={e => setEditForm({ ...editForm, category: e.target.value as any })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-blue-500/50 outline-none"
                            >
                                {Object.entries(categories).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm text-gray-400 mb-1">نص الرسالة</label>
                        <textarea
                            value={editForm.content}
                            onChange={e => setEditForm({ ...editForm, content: e.target.value })}
                            className="w-full h-32 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500/50 outline-none resize-none"
                            placeholder="اكتب نص الرسالة هنا... يمكنك استخدام {name} لاسم الطالب"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                            يمكنك استخدام المتغيرات التالية: {'{name}'} (اسم الطالب)، {'{date}'} (التاريخ)، {'{class}'} (الصف)
                        </p>
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={() => setIsEditing(null)}
                            className="px-6 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                        >
                            إلغاء
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-8 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2"
                        >
                            <Save className="w-4 h-4" />
                            حفظ القالب
                        </button>
                    </div>
                </div>
            )}

            {/* List View */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates.map(tmpl => (
                    <div
                        key={tmpl.id}
                        className={`glass-card p-5 rounded-2xl border border-white/10 hover:border-white/20 transition-all group relative ${isEditing === tmpl.id ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tmpl.category === 'absence' ? 'bg-red-500/20 text-red-400' :
                                        tmpl.category === 'late' ? 'bg-orange-500/20 text-orange-400' :
                                            tmpl.category === 'behavior' ? 'bg-purple-500/20 text-purple-400' :
                                                'bg-blue-500/20 text-blue-400'
                                    }`}>
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-white text-lg">{tmpl.name}</h4>
                                    <span className="text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded">
                                        {categories[tmpl.category]}
                                    </span>
                                </div>
                            </div>

                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => handleEdit(tmpl)}
                                    className="p-2 hover:bg-white/10 rounded-lg text-blue-400 transition-colors"
                                >
                                    <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(tmpl.id)}
                                    className="p-2 hover:bg-white/10 rounded-lg text-red-400 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <p className="text-gray-400 text-sm line-clamp-3 mb-4 min-h-[4.5rem]">
                            {tmpl.content}
                        </p>

                        <button
                            onClick={() => handleEdit(tmpl)}
                            className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm transition-colors border border-white/5 hover:border-white/10"
                        >
                            تعديل / استخدام
                        </button>
                    </div>
                ))}
            </div>

            {templates.length === 0 && !isEditing && (
                <div className="text-center py-12 text-gray-500 bg-white/5 rounded-3xl border border-dashed border-white/10">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>لا توجد قوالب محفوظة بعد.</p>
                    <button onClick={handleCreate} className="mt-4 text-blue-400 hover:underline">إنشاء أول قالب</button>
                </div>
            )}
        </div>
    );
};
