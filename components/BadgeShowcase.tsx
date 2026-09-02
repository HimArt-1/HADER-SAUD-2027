import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Award, Star, Clock } from 'lucide-react';

interface Badge {
    filename: string;
    url: string;
    time: number;
}

const WHATSAPP_API_URL = import.meta.env.VITE_WHATSAPP_API_URL || 'http://localhost:5005';

interface Props {
    isActive: boolean;
}

const BadgeShowcase: React.FC<Props> = ({ isActive }) => {
    const [badges, setBadges] = useState<Badge[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);

    // Fetch badges
    useEffect(() => {
        if (!isActive) return;

        const fetchBadges = async () => {
            try {
                if (!WHATSAPP_API_URL || WHATSAPP_API_URL.includes('localhost') && window.location.hostname !== 'localhost') {
                    setLoading(false);
                    return;
                }
                const res = await fetch(`${WHATSAPP_API_URL}/badges/latest`);
                if (res.ok) {
                    const data = await res.json();
                    setBadges(data);
                } else {
                    setBadges([]);
                }
            } catch (error) {
                console.warn('Badge Showcase: API not available or unreachable.');
                setBadges([]);
            } finally {
                setLoading(false);
            }
        };

        fetchBadges();
        const interval = setInterval(fetchBadges, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, [isActive]);

    // Rotate badges
    useEffect(() => {
        if (!isActive || badges.length === 0) return;

        const timer = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % badges.length);
        }, 5000); // 5 seconds per badge

        return () => clearInterval(timer);
    }, [isActive, badges]);

    if (!isActive) return null;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full w-full text-white">
                تحميل الأوسمة...
            </div>
        );
    }

    if (badges.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full text-white/50 space-y-4">
                <Award className="w-24 h-24 opacity-20" />
                <p className="text-2xl font-light">لا توجد أوسمة حديثة للعرض</p>
            </div>
        );
    }

    // Display single badge full screen with effects
    const currentBadge = badges[currentIndex];
    // Calculate specific URL (handling potential base URL differences)
    const imageUrl = `${WHATSAPP_API_URL}${currentBadge.url}`;

    return (
        <div className="relative w-full h-full overflow-hidden flex items-center justify-center bg-black/90 backdrop-blur-sm z-50">
            {/* Background Ambience */}
            <div className="absolute inset-0 bg-gradient-to-tr from-secondary-900/20 via-black to-emerald-900/20" />

            {/* Animated Particles/Orbs */}
            <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
                transition={{ duration: 8, repeat: Infinity }}
                className="absolute top-1/4 left-1/4 w-96 h-96 bg-secondary-600/20 rounded-full blur-[100px]"
            />
            <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [0.2, 0.4, 0.2] }}
                transition={{ duration: 10, repeat: Infinity, delay: 1 }}
                className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[120px]"
            />

            {/* Main Content */}
            <div className="relative z-10 w-full max-w-5xl p-8 flex flex-col items-center">

                {/* Header */}
                <motion.div
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="mb-12 text-center"
                >
                    <div className="flex items-center justify-center gap-3 mb-2">
                        <Star className="w-8 h-8 text-yellow-400 fill-yellow-400 animate-pulse" />
                        <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-white to-yellow-300 drop-shadow-[0_0_15px_rgba(255,215,0,0.5)]">
                            لوحة الشرف والتميز
                        </h1>
                        <Star className="w-8 h-8 text-yellow-400 fill-yellow-400 animate-pulse" />
                    </div>
                    <p className="text-xl text-white/70">نحتفي بطلابنا المتميزين</p>
                </motion.div>

                {/* Badge Card */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentBadge.filename}
                        initial={{ opacity: 0, scale: 0.8, rotateY: 90 }}
                        animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                        exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
                        transition={{ type: "spring", stiffness: 100, damping: 20 }}
                        className="relative group cursor-none"
                    >
                        {/* Glow Effect */}
                        <div className="absolute -inset-4 bg-gradient-to-r from-yellow-500/30 to-secondary-600/30 rounded-[30px] blur-xl opacity-75 group-hover:opacity-100 transition-opacity" />

                        {/* Image Container */}
                        <div className="relative bg-white/5 border border-white/10 rounded-[20px] p-4 backdrop-blur-md shadow-2xl">
                            <img
                                src={imageUrl}
                                alt="Award"
                                className="max-h-[60vh] object-contain rounded-lg shadow-inner"
                            />
                        </div>

                        {/* Reflection/Shine */}
                        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-tr from-white/10 to-transparent pointer-events-none" />
                    </motion.div>
                </AnimatePresence>

                {/* Progress Bar */}
                <div className="mt-12 w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                        key={currentIndex}
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 5, ease: "linear" }}
                        className="h-full bg-gradient-to-r from-yellow-400 to-amber-500"
                    />
                </div>

                {/* Stats/Counter */}
                <div className="mt-4 text-white/30 font-mono text-sm">
                    {currentIndex + 1} / {badges.length}
                </div>

            </div>
        </div>
    );
};

export default BadgeShowcase;
