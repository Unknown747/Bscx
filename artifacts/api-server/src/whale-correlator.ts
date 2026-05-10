/**
 * whale-correlator.ts — Whale Correlation Map
 * Deteksi apakah 2+ whale membeli token yang sama dalam window waktu tertentu.
 * Sinyal kuat: multiple whale bergerak bersama = coordinated play.
 */

const WINDOW_MS = 10 * 60_000; // 10 menit
const MIN_WHALES_FOR_SIGNAL = 2;

interface BuyEvent {
    walletAddress: string;
    walletName:    string;
    tokenAddress:  string;
    tokenSymbol:   string;
    timestamp:     number;
    buyAmountEth:  number;
}

interface CorrelationSignal {
    tokenAddress:  string;
    tokenSymbol:   string;
    whaleCount:    number;
    whales:        { address: string; name: string; timestamp: number; amountEth: number }[];
    firstBuyAt:    number;
    lastBuyAt:     number;
    confidence:    number; // 0-100
    windowMinutes: number;
}

// In-memory time-windowed buy events
const buyEvents: BuyEvent[] = [];
// Track last clean time
let lastClean = Date.now();

export function recordWhaleBuy(
    walletAddress: string,
    walletName: string,
    tokenAddress: string,
    tokenSymbol: string,
    buyAmountEth = 0,
): void {
    buyEvents.push({
        walletAddress: walletAddress.toLowerCase(),
        walletName,
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol,
        timestamp:    Date.now(),
        buyAmountEth,
    });

    // Periodic cleanup
    if (Date.now() - lastClean > 60_000) {
        cleanupOldEvents();
        lastClean = Date.now();
    }
}

function cleanupOldEvents(): void {
    const cutoff = Date.now() - WINDOW_MS * 2; // keep 2x window for history
    let i = 0;
    while (i < buyEvents.length && buyEvents[i].timestamp < cutoff) i++;
    if (i > 0) buyEvents.splice(0, i);
}

export function getActiveCorrelations(): CorrelationSignal[] {
    cleanupOldEvents();
    const now    = Date.now();
    const cutoff = now - WINDOW_MS;

    // Group recent events by token
    const byToken = new Map<string, BuyEvent[]>();
    for (const ev of buyEvents) {
        if (ev.timestamp < cutoff) continue;
        const list = byToken.get(ev.tokenAddress) ?? [];
        list.push(ev);
        byToken.set(ev.tokenAddress, list);
    }

    const signals: CorrelationSignal[] = [];
    for (const [tokenAddress, events] of byToken) {
        // Deduplicate by wallet
        const uniqueWallets = new Map<string, BuyEvent>();
        for (const ev of events) {
            if (!uniqueWallets.has(ev.walletAddress) ||
                ev.timestamp < uniqueWallets.get(ev.walletAddress)!.timestamp) {
                uniqueWallets.set(ev.walletAddress, ev);
            }
        }

        if (uniqueWallets.size < MIN_WHALES_FOR_SIGNAL) continue;

        const walletList = Array.from(uniqueWallets.values());
        const timestamps  = walletList.map(e => e.timestamp);
        const firstBuyAt  = Math.min(...timestamps);
        const lastBuyAt   = Math.max(...timestamps);
        const windowMin   = (lastBuyAt - firstBuyAt) / 60_000;

        // Confidence: more whales + tighter window = higher confidence
        const countScore   = Math.min(50, (uniqueWallets.size - 1) * 15);  // 15pt per extra whale
        const timeScore    = Math.max(0, Math.round(50 * (1 - windowMin / 10))); // tighter window = better (0-50 range)
        const confidence   = Math.min(100, Math.round(countScore + timeScore));

        signals.push({
            tokenAddress,
            tokenSymbol:  walletList[0].tokenSymbol,
            whaleCount:   uniqueWallets.size,
            whales:       walletList.map(e => ({
                address:   e.walletAddress,
                name:      e.walletName,
                timestamp: e.timestamp,
                amountEth: e.buyAmountEth,
            })),
            firstBuyAt,
            lastBuyAt,
            confidence,
            windowMinutes: Math.round(windowMin * 10) / 10,
        });
    }

    // Sort by confidence desc
    return signals.sort((a, b) => b.confidence - a.confidence);
}

export function checkTokenCorrelation(tokenAddress: string): CorrelationSignal | null {
    const all = getActiveCorrelations();
    return all.find(s => s.tokenAddress === tokenAddress.toLowerCase()) ?? null;
}

export function getCorrelationBonus(tokenAddress: string): number {
    const sig = checkTokenCorrelation(tokenAddress);
    if (!sig) return 0;
    // Bonus multiplier for copy amount: 0-20% extra based on correlation confidence
    return Math.round(sig.confidence / 5); // 0-20 bonus points
}

export default { recordWhaleBuy, getActiveCorrelations, checkTokenCorrelation, getCorrelationBonus };
