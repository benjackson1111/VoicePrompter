export type VisitorPlatform = 'ios' | 'android' | 'mac' | 'linux' | 'windows' | 'other';
export type NativePromoPlatform = 'ios' | 'android' | 'mac';

export interface NativePromoPair {
    line1: string;
    line2: string;
    rotating: string[];
}

export interface NativePromo {
    platform: NativePromoPlatform;
    title: string;
    href: string;
    analyticsEvent: string;
    pairs: NativePromoPair[];
}

interface NavigatorPlatformData {
    userAgent: string;
    platform: string;
    maxTouchPoints: number;
}

const NATIVE_PROMOS: Record<NativePromoPlatform, NativePromo> = {
    ios: {
        platform: 'ios',
        title: 'Try native iOS app',
        href: '/ios/',
        analyticsEvent: 'settings-banner-ios',
        pairs: [
            {
                line1: 'Next-gen voice scrolling',
                line2: 'Handles ',
                rotating: ['pauses', 'ad-libs', 'skipped lines', 'changes of pace']
            },
            {
                line1: 'Float over apps or record in 4K',
                line2: 'Perfect for ',
                rotating: ['Reels', 'TikTok', 'YouTube Shorts', 'live streams']
            }
        ]
    },
    android: {
        platform: 'android',
        title: 'Try native Android app',
        href: '/android/',
        analyticsEvent: 'settings-banner-android',
        pairs: [
            {
                line1: 'Next-gen voice scrolling',
                line2: 'Handles ',
                rotating: ['pauses', 'ad-libs', 'skipped lines', 'changes of pace']
            },
            {
                line1: 'Float over apps or record in 4K',
                line2: 'Perfect for ',
                rotating: ['Reels', 'TikTok', 'YouTube Shorts', 'live streams']
            }
        ]
    },
    mac: {
        platform: 'mac',
        title: 'Try native macOS app',
        href: '/mac/',
        analyticsEvent: 'settings-banner-mac',
        pairs: [
            {
                line1: 'Next-gen voice scrolling',
                line2: 'Handles ',
                rotating: ['pauses', 'ad-libs', 'skipped lines', 'changes of pace']
            },
            {
                line1: 'Invisible during screen sharing',
                line2: 'Perfect for ',
                rotating: ['video calls', 'sales demos', 'interviews', 'presentations']
            },
            {
                line1: 'Invisible on screen recordings',
                line2: 'Perfect for ',
                rotating: ['Looms', 'YouTube videos', 'tutorials', 'product demos']
            }
        ]
    }
};

export function detectVisitorPlatform(
    navigatorData: NavigatorPlatformData = navigator
): VisitorPlatform {
    const { userAgent, platform, maxTouchPoints } = navigatorData;

    if (/iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
        return 'ios';
    }
    if (/Android/i.test(userAgent)) {
        return 'android';
    }
    if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(userAgent)) {
        return 'mac';
    }
    if (/Linux/i.test(platform) || /Linux/i.test(userAgent)) {
        return 'linux';
    }
    if (/Win/i.test(platform) || /Windows/i.test(userAgent)) {
        return 'windows';
    }
    return 'other';
}

export function getNativePromo(visitorPlatform: VisitorPlatform): NativePromo {
    if (visitorPlatform === 'ios') return NATIVE_PROMOS.ios;
    if (visitorPlatform === 'android') return NATIVE_PROMOS.android;
    return NATIVE_PROMOS.mac;
}
