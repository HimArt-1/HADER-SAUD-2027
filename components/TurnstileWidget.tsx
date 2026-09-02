import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

type TurnstileWidgetProps = Readonly<{
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
}>;

const SCRIPT_ID = 'hader-turnstile-script';

const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({ siteKey, resetKey, onToken }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let widgetId: string | null = null;
    let pollId: number | null = null;

    const renderWidget = () => {
      if (disposed || widgetId || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: 'hader_login',
        theme: 'dark',
        language: 'ar',
        size: 'flexible',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null)
      });
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!existing) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.addEventListener('load', renderWidget, { once: true });
      document.head.appendChild(script);
    } else if (window.turnstile) {
      renderWidget();
    } else {
      pollId = window.setInterval(() => {
        if (window.turnstile) {
          if (pollId !== null) window.clearInterval(pollId);
          pollId = null;
          renderWidget();
        }
      }, 100);
    }

    return () => {
      disposed = true;
      if (pollId !== null) window.clearInterval(pollId);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      onToken(null);
    };
  }, [onToken, resetKey, siteKey]);

  return <div ref={containerRef} className="min-h-[65px] w-full overflow-hidden rounded-2xl" />;
};

export default TurnstileWidget;
