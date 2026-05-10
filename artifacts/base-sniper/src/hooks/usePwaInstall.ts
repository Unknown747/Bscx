import { useEffect, useState } from 'react';

export function usePwaInstall() {
    const [prompt, setPrompt]       = useState<any>(null);
    const [installed, setInstalled] = useState(false);

    useEffect(() => {
        const handler = (e: Event) => {
            e.preventDefault();
            setPrompt(e);
        };
        window.addEventListener('beforeinstallprompt', handler);

        const mql = window.matchMedia('(display-mode: standalone)');
        setInstalled(mql.matches || (navigator as any).standalone === true);
        const mqHandler = (e: MediaQueryListEvent) => setInstalled(e.matches);
        mql.addEventListener('change', mqHandler);

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
            mql.removeEventListener('change', mqHandler);
        };
    }, []);

    const install = async () => {
        if (!prompt) return false;
        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
            setPrompt(null);
            setInstalled(true);
            return true;
        }
        return false;
    };

    return { canInstall: !!prompt && !installed, install, installed };
}
