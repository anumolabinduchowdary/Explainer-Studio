/**
 * Plain names for YouTube's codes. Values are from the YouTube Analytics API
 * dimensions reference: https://developers.google.com/youtube/analytics/dimensions
 */

const TRAFFIC: Record<string, string> = {
  SHORTS: "Shorts feed",
  RELATED_VIDEO: "Suggested next to other videos",
  SUBSCRIBER: "Home page and subscription feeds",
  YT_SEARCH: "YouTube search",
  EXT_URL: "Links on other websites",
  NO_LINK_OTHER: "Direct, or links in apps like WhatsApp",
  NO_LINK_EMBEDDED: "Played on other websites",
  NOTIFICATION: "Notifications",
  YT_CHANNEL: "Your channel page",
  PLAYLIST: "Playlists",
  YT_PLAYLIST_PAGE: "Playlist pages",
  END_SCREEN: "End screens",
  HASHTAGS: "Hashtag pages",
  SOUND_PAGE: "Shorts sound pages",
  VIDEO_REMIXES: "Remixes",
  YT_OTHER_PAGE: "Other YouTube pages",
  ADVERTISING: "Ads",
  PROMOTED: "YouTube promotion",
  ANNOTATION: "Annotations",
  CAMPAIGN_CARD: "Campaign cards",
  LIVE_REDIRECT: "Live redirects",
  PRODUCT_PAGE: "Product pages",
  WATCH_WITH: "Watch-with streams",
};

/** Sources where YouTube itself chose to show the video to people. */
export const RECOMMENDED_SOURCES = new Set(["SHORTS", "RELATED_VIDEO", "SUBSCRIBER", "HASHTAGS", "SOUND_PAGE", "VIDEO_REMIXES"]);
/** Sources outside YouTube: links shared in apps, websites, messages. */
export const OUTSIDE_SOURCES = new Set(["EXT_URL", "NO_LINK_OTHER", "NO_LINK_EMBEDDED"]);

const SHARING: Record<string, string> = {
  WHATS_APP: "WhatsApp",
  WHATS_APP_BUSINESS: "WhatsApp Business",
  COPY_PASTE: "Copied link",
  FACEBOOK: "Facebook",
  FACEBOOK_MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
  TWITTER: "X (Twitter)",
  TELEGRAM: "Telegram",
  ANDROID_SYSTEM_SHARE_DIALOG: "Android share menu",
  IOS_SYSTEM_ACTIVITY_DIALOG: "iPhone share menu",
  DIRECT_SYSTEM_ACTIVITY_DIALOG: "Share menu",
  GMAIL: "Gmail",
  ANDROID_MESSENGER: "Text message",
  ANDROID_MMS: "Text message",
  REDDIT: "Reddit",
  LINKEDIN: "LinkedIn",
  PINTEREST: "Pinterest",
  YOUTUBE_MESSAGES: "YouTube messages",
  EMAIL: "Email",
};

const DEVICES: Record<string, string> = {
  MOBILE: "Phones",
  TABLET: "Tablets",
  DESKTOP: "Computers",
  TV: "TV",
  GAME_CONSOLE: "Game consoles",
  AUTOMOTIVE: "Cars",
  WEARABLE: "Watches",
  UNKNOWN_PLATFORM: "Other",
};

/** "SOME_CODE" -> "Some code". */
const humanize = (code: string) => {
  const words = code.toLowerCase().replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Other";
};

export const trafficLabel = (source: string) => TRAFFIC[source] ?? humanize(source);

/** The recommended sources, as they read inside a sentence. */
const TRAFFIC_PHRASES: Record<string, string> = {
  SHORTS: "the Shorts feed",
  RELATED_VIDEO: "suggestions next to other videos",
  SUBSCRIBER: "the home page and subscription feeds",
  HASHTAGS: "hashtag pages",
  SOUND_PAGE: "Shorts sound pages",
  VIDEO_REMIXES: "remixes",
};
export const trafficPhrase = (source: string) => TRAFFIC_PHRASES[source] ?? trafficLabel(source).toLowerCase();
export const sharingLabel = (service: string) => SHARING[service] ?? humanize(service);
export const deviceLabel = (type: string) => DEVICES[type] ?? humanize(type);

let regions: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "age18-24" -> "18–24", "age65-" -> "65+". */
export function ageLabel(group: string): string {
  const match = group.match(/^age(\d+)-(\d*)$/);
  if (!match) return humanize(group);
  return match[2] ? `${match[1]}–${match[2]}` : `${match[1]}+`;
}

export function genderLabel(gender: string): string {
  if (gender === "female") return "Women";
  if (gender === "male") return "Men";
  return "Self-described";
}
