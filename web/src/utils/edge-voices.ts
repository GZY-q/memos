/**
 * Built-in Edge neural voices offered for memo read-aloud. Short names are
 * verified against the live Edge voice catalog. The service has many more
 * voices, but this curated list covers Mandarin variants, Cantonese,
 * Taiwanese Mandarin and multilingual English.
 */
export interface EdgeVoice {
  shortName: string;
  label: string;
  gender: "female" | "male";
  locale: string;
}

export const EDGE_VOICES: EdgeVoice[] = [
  { shortName: "zh-CN-XiaoxiaoNeural", label: "晓晓（普通话·女声）", gender: "female", locale: "zh-CN" },
  { shortName: "zh-CN-XiaoyiNeural", label: "晓伊（普通话·女声）", gender: "female", locale: "zh-CN" },
  { shortName: "zh-CN-YunxiNeural", label: "云希（普通话·男声）", gender: "male", locale: "zh-CN" },
  { shortName: "zh-CN-YunyangNeural", label: "云扬（普通话·男声）", gender: "male", locale: "zh-CN" },
  { shortName: "zh-CN-YunxiaNeural", label: "云夏（普通话·男童）", gender: "male", locale: "zh-CN" },
  { shortName: "zh-CN-YunjianNeural", label: "云健（普通话·男声）", gender: "male", locale: "zh-CN" },
  { shortName: "zh-CN-liaoning-XiaobeiNeural", label: "晓北（东北话·女声）", gender: "female", locale: "zh-CN-liaoning" },
  { shortName: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮（陕西话·女声）", gender: "female", locale: "zh-CN-shaanxi" },
  { shortName: "zh-HK-HiuGaaiNeural", label: "曉佳（粤语·女声）", gender: "female", locale: "zh-HK" },
  { shortName: "zh-HK-HiuMaanNeural", label: "曉曼（粤语·女声）", gender: "female", locale: "zh-HK" },
  { shortName: "zh-HK-WanLungNeural", label: "雲龍（粤语·男声）", gender: "male", locale: "zh-HK" },
  { shortName: "zh-TW-HsiaoChenNeural", label: "曉臻（台湾国语·女声）", gender: "female", locale: "zh-TW" },
  { shortName: "zh-TW-HsiaoYuNeural", label: "曉雨（台湾国语·女声）", gender: "female", locale: "zh-TW" },
  { shortName: "zh-TW-YunJheNeural", label: "雲哲（台湾国语·男声）", gender: "male", locale: "zh-TW" },
  { shortName: "en-US-EmmaMultilingualNeural", label: "Emma（英语多语种·女声）", gender: "female", locale: "en-US" },
  { shortName: "en-US-BrianMultilingualNeural", label: "Brian（英语多语种·男声）", gender: "male", locale: "en-US" },
];

export const DEFAULT_EDGE_VOICE = "zh-CN-XiaoxiaoNeural";
