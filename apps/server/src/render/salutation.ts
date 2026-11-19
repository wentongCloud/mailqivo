import { COUNTRY_KEYS, countryCode, readProfileField } from "@mailqivo/shared";
import baijiaxing from "./dicts/baijiaxing.json" with { type: "json" };
import surnameVariants from "./dicts/chinese-surname-variants.json" with { type: "json" };
import honorifics from "./dicts/english-honorifics.json" with { type: "json" };

/**
 * 内置变量 {{称呼}} 的生成规则。
 * 国家/地区按 ISO 3166-1 二位代码（不区分大小写）或简体中文名称识别，来源：
 * https://zh.wikipedia.org/zh-cn/ISO_3166-1 。
 * 中国：姓 + 职位后缀（总监 / 经理）；其他标准地区：英文 First Name；其余返回 undefined。
 *
 * 国家/地区标准表与识别规则在 @mailqivo/shared（iso3166.ts、contact-profile.ts）。
 * 字典（dicts/）：
 * - baijiaxing.json：百家姓（简体），拆中文姓
 * - chinese-surname-variants.json：华人姓氏的拼写变体——繁体字对照、拉丁拼写
 * - english-honorifics.json：英文称谓与名后缀，按国家/地区分组
 */
export const SALUTATION_KEY = "称呼";

/** 按字数从长到短排列，复姓优先匹配；郁、后在《百家姓》原文中各出现两次，去重。 */
const HAN_SURNAMES = [...new Set(baijiaxing.map((row) => row.name))].sort((a, b) => b.length - a.length);
const TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = surnameVariants.traditional;
const ROMANIZED_SURNAMES = new Set(surnameVariants.romanized);
const SPACED_COMPOUND_SURNAMES = new Set(["au yeung", "ou yang", "si ma", "si tu", "sze to"]);

const HONORIFIC_PREFIXES = new Set(Object.values(honorifics.prefixes).flat());
const NAME_SUFFIXES = new Set(Object.values(honorifics.suffixes).flat());
const PREFIX_MAX_WORDS = Math.max(...[...HONORIFIC_PREFIXES].map((prefix) => prefix.split(" ").length));

/** 华人常把姓写在前面（Tan Wei Ming、CHAN Tai Man）的地区。中国大陆走中文规则，不在此列。 */
const SURNAME_FIRST_REGIONS = new Set(["HK", "MO", "TW", "SG", "MY"]);

const HAN_NAME = /^\p{Script=Han}+$/u;
const LATIN_WORD = /^\p{Script=Latin}[\p{Script=Latin}'’.-]*$/u;
/** 一个汉字的拉丁拼写：声母（至多 3 个辅音）+ 韵母元音 + 可选韵尾。Wei、Ming、Kwok、Hsien、Yeung 都符合。 */
const ROMANIZED_SYLLABLE = /^[bcdfghjklmnpqrstvwxz]{0,3}[aeiouyü]{1,3}(?:ng|nn|ck|[nmktphrwl])?$/;
/** 没有元音的粤语音节（Chan Tsz Ho）。 */
const VOWELLESS_SYLLABLES = new Set(["tsz", "sz", "ng", "m"]);
const ENGLISH_NAMES_OVERLAPPING_SYLLABLES = new Set(["paul", "jack", "ryan", "sean", "nick", "tom", "sam", "ken"]);

export type SalutationContact = {
  name?: string | null;
  title?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

/** 所有输入的统一预处理：NFKC（全角 → 半角、兼容字 → 标准字）后去首尾空白。 */
function normalizeText(value: string | null | undefined): string {
  return value?.normalize("NFKC").trim() ?? "";
}

/** 拉丁词比对用的形式：小写，去掉点号、撇号和连字号（Ph.D. → phd，Dato' → dato，Au-Yeung → auyeung）。 */
function dictToken(token: string): string {
  return token.toLowerCase().replace(/[.'’-]/g, "");
}

/** 用百家姓拆出简体姓；繁体字先转简体，复姓优先，至少要留一个字作名。拆不出返回 undefined。 */
export function chineseSurname(name: string | null | undefined): string | undefined {
  const compact = normalizeText(name).replace(/[\s·・]/gu, "");
  if (!HAN_NAME.test(compact)) return undefined;
  const simplified = Array.from(compact, (char) => TRADITIONAL_TO_SIMPLIFIED[char] ?? char).join("");
  return HAN_SURNAMES.find((surname) => simplified.length > surname.length && simplified.startsWith(surname));
}

/** 职位含「总监 / director」→ 总监；否则含「经理 / manager」→ 经理；繁体同样识别。 */
export function titleSuffix(title: string | null | undefined): "总监" | "经理" | undefined {
  const value = normalizeText(title).toLowerCase();
  if (/总监|總監|director/.test(value)) return "总监";
  if (/经理|經理|manager/.test(value)) return "经理";
  return undefined;
}

/** 跳过开头的称谓，返回第一个非称谓词的下标；多词称谓优先（Tan Sri 整体匹配，单独的 Tan 是姓）。 */
function skipHonorifics(tokens: string[]): number {
  let index = 0;
  while (index < tokens.length) {
    let matched = 0;
    for (let words = Math.min(PREFIX_MAX_WORDS, tokens.length - index); words >= 1; words--) {
      if (HONORIFIC_PREFIXES.has(tokens.slice(index, index + words).map(dictToken).join(" "))) {
        matched = words;
        break;
      }
    }
    if (!matched) break;
    index += matched;
  }
  return index;
}

function isGivenWord(token: string): boolean {
  return LATIN_WORD.test(token) && !token.endsWith(".") && token.replace(/[^\p{L}]/gu, "").length >= 2;
}

/** 整个词（含连字号，Wei-Ming）都是汉字拼音音节。 */
function isRomanizedGiven(token: string): boolean {
  return token.split("-").every((part) => {
    const syllable = dictToken(part);
    return ROMANIZED_SYLLABLE.test(syllable) || VOWELLESS_SYLLABLES.has(syllable);
  });
}

function isAllCaps(token: string): boolean {
  return /^\p{Lu}[\p{Lu}'’-]+$/u.test(token);
}

/** 拼写变体里有，或写成全大写而名字其余部分不是（CHAN Tai Man）。 */
function isRomanizedSurname(token: string, others: string[]): boolean {
  if (ROMANIZED_SURNAMES.has(dictToken(token))) return true;
  return isAllCaps(token) && others.some((other) => !isAllCaps(other));
}

function hasSpacedCompoundSurname(tokens: string[]): boolean {
  return SPACED_COMPOUND_SURNAMES.has(tokens.slice(0, 2).map(dictToken).join(" "));
}

/**
 * 姓后面的部分：有英文名（Tan Peter、Chan Tai Man Peter）取英文名；
 * 全是拼音音节时，1～2 个音节是中文名（Wei Ming），3 个以上最后一个当英文名（Chan Tai Man Ken）。
 */
function givenAfterSurname(tokens: string[]): string | undefined {
  if (!tokens.length) return undefined;
  const englishIndex = tokens.findIndex((token) => !isRomanizedGiven(token));
  if (englishIndex >= 0) {
    // Keep all-romanized names intact when an English spelling also works as a syllable.
    const knownEnglish = tokens.slice(0, englishIndex).find((token) => ENGLISH_NAMES_OVERLAPPING_SYLLABLES.has(token.toLowerCase()));
    const english = knownEnglish ?? tokens[englishIndex]!;
    return isGivenWord(english) ? english : undefined;
  }
  if (tokens.length <= 2) return tokens.every((token) => LATIN_WORD.test(token)) ? tokens.join(" ") : undefined;
  const last = tokens.at(-1)!;
  return isGivenWord(last) ? last : undefined;
}

/**
 * 英文 First Name：「John Smith」「Smith, John」「Dr. John Smith, PhD」都取 John。
 * 跳过开头的称谓；「Mr Smith」这种称谓后只剩一个词的，是姓不是名，返回 undefined。
 * 只有缩写（J. Smith）或非拉丁字母名字也返回 undefined。
 * surnameFirst：华人姓在前的地区，「Tan Wei Ming」取 Wei Ming，「CHAN Tai Man, Peter」取 Peter。
 */
export function englishFirstName(name: string | null | undefined, options: { surnameFirst?: boolean } = {}): string | undefined {
  const value = normalizeText(name);
  if (!value) return undefined;
  const [head = "", ...rest] = value.split(",").map((part) => part.trim());
  const headTokens = head.split(/\s+/);
  const tail = rest.join(" ");
  const tailIsSuffix = tail !== "" && tail.split(/\s+/).every((token) => NAME_SUFFIXES.has(dictToken(token)));
  const lastFirst = tail !== "" && !tailIsSuffix;
  const tokens = lastFirst ? tail.split(/\s+/) : headTokens;
  const start = skipHonorifics(tokens);
  if (start >= tokens.length) return undefined;
  if (!lastFirst && start > 0 && tokens.length - start < 2) return undefined;
  const named = tokens.slice(start);
  if (options.surnameFirst) {
    if (lastFirst) {
      if (
        (headTokens.length === 1 && isRomanizedSurname(headTokens[0]!, named)) ||
        (headTokens.length === 2 && hasSpacedCompoundSurname(headTokens))
      ) return givenAfterSurname(named);
    } else {
      const surnameLength = hasSpacedCompoundSurname(named) ? 2
        : isRomanizedSurname(named[0]!, named.slice(1)) ? 1 : 0;
      if (surnameLength) return givenAfterSurname(named.slice(surnameLength));
    }
  }
  const first = named[0]!;
  return isGivenWord(first) ? first : undefined;
}

/**
 * 取值顺序：自定义字段「称呼」→ 按国家生成 → undefined（交给模板默认值或跳过）。
 * 渲染（{{称呼}}）与 AI 区块字段共用此函数。
 */
export function resolveSalutation(contact: SalutationContact): string | undefined {
  const custom = readProfileField(contact.custom_fields, [SALUTATION_KEY]);
  if (custom) return custom;
  const code = countryCode(readProfileField(contact.custom_fields, COUNTRY_KEYS));
  if (!code) return undefined;
  if (code === "CN") {
    const surname = chineseSurname(contact.name);
    const suffix = titleSuffix(contact.title);
    return surname && suffix ? `${surname}${suffix}` : undefined;
  }
  return englishFirstName(contact.name, { surnameFirst: SURNAME_FIRST_REGIONS.has(code) });
}
