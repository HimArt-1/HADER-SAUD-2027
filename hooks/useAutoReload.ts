import { useEffect } from 'react';

/**
 * A hook that schedules a full page reload at a specific time of day (e.g., midnight)
 * to prevent memory leaks in persistent/always-on screens.
 * 
 * @param reloadHour The hour of the day (0-23) to trigger the reload. Default is 0 (midnight).
 * @param reloadMinute The minute of the hour (0-59) to trigger the reload. Default is 0.
 */
export const useAutoReload = (reloadHour: number = 0, reloadMinute: number = 0) => {
    useEffect(() => {
        let timeoutId: NodeJS.Timeout;

        const scheduleReload = () => {
            const now = new Date();
            const targetTime = new Date();
            
            targetTime.setHours(reloadHour, reloadMinute, 0, 0);

            // If the target time has already passed today, schedule for tomorrow
            if (now.getTime() > targetTime.getTime()) {
                targetTime.setDate(targetTime.getDate() + 1);
            }

            const timeUntilReload = targetTime.getTime() - now.getTime();
            
            // Log for debugging (only in development)
            if (process.env.NODE_ENV === 'development') {
                console.log(`Auto-reload scheduled in ${Math.round(timeUntilReload / 1000 / 60)} minutes.`);
            }

            timeoutId = setTimeout(() => {
                window.location.reload();
            }, timeUntilReload);
        };

        scheduleReload();

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [reloadHour, reloadMinute]);
};
