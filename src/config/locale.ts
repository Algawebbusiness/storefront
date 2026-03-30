/**
 * Locale settings for display formatting. Currency comes from Saleor channels, not here.
 */

import { type Locale, defaultLocale } from "@/i18n/config";

type LocaleSettings = {
	/** Locale for Intl APIs (number/date formatting) - BCP 47 format */
	default: string;
	/** Language code for Saleor API - controls translated content */
	graphqlLanguageCode: string;
	/** HTML lang attribute */
	htmlLang: string;
	/** Open Graph locale */
	ogLocale: string;
	/** Fallback currency when API returns null */
	fallbackCurrency: string;
};

const localeMap: Record<Locale, LocaleSettings> = {
	cs: {
		default: "cs-CZ",
		graphqlLanguageCode: "CS_CZ",
		htmlLang: "cs",
		ogLocale: "cs_CZ",
		fallbackCurrency: "CZK",
	},
	en: {
		default: "en-US",
		graphqlLanguageCode: "EN_US",
		htmlLang: "en",
		ogLocale: "en_US",
		fallbackCurrency: "USD",
	},
};

/**
 * Get locale-specific config for a given locale.
 */
export function getLocaleConfig(locale: Locale): LocaleSettings {
	return localeMap[locale] ?? localeMap[defaultLocale];
}

/**
 * Default locale config — uses the template's default locale (cs).
 * Existing code importing `localeConfig` continues to work unchanged.
 */
export const localeConfig = localeMap[defaultLocale];

/**
 * Format a price with the given or default locale.
 */
export function formatPrice(amount: number, currency: string, locale?: string): string {
	return new Intl.NumberFormat(locale ?? localeConfig.default, {
		style: "currency",
		currency: currency,
	}).format(amount);
}

/**
 * Format a date with the given or default locale.
 */
export function formatDate(date: Date | number, options?: Intl.DateTimeFormatOptions, locale?: string): string {
	return new Intl.DateTimeFormat(locale ?? localeConfig.default, {
		dateStyle: "medium",
		...options,
	}).format(date);
}

/**
 * Format a number with the given or default locale.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale?: string): string {
	return new Intl.NumberFormat(locale ?? localeConfig.default, options).format(value);
}
