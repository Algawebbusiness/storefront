import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, locales, type Locale } from "./config";

export default getRequestConfig(async () => {
	const cookieStore = await cookies();
	const headerStore = await headers();

	// 1. Check cookie
	const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value as Locale | undefined;
	if (cookieLocale && locales.includes(cookieLocale)) {
		return {
			locale: cookieLocale,
			messages: (await import(`../messages/${cookieLocale}.json`)).default,
		};
	}

	// 2. Check Accept-Language header
	const acceptLanguage = headerStore.get("accept-language") || "";
	const prefersCzech = acceptLanguage.toLowerCase().includes("cs");
	const locale: Locale = prefersCzech ? "cs" : defaultLocale;

	return {
		locale,
		messages: (await import(`../messages/${locale}.json`)).default,
	};
});
