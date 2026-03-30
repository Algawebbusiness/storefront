"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { type Locale, locales } from "@/i18n/config";

const localeLabels: Record<Locale, string> = {
	cs: "CZ",
	en: "EN",
};

export function LocaleSwitcher() {
	const locale = useLocale() as Locale;
	const router = useRouter();

	const handleChange = (newLocale: Locale) => {
		document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
		router.refresh();
	};

	return (
		<div className="flex items-center gap-1 text-sm">
			{locales.map((l, i) => (
				<span key={l} className="flex items-center gap-1">
					{i > 0 && <span className="text-muted-foreground">/</span>}
					<button
						type="button"
						onClick={() => handleChange(l)}
						className={`transition-colors ${
							locale === l
								? "font-semibold text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
						aria-label={`Switch to ${localeLabels[l]}`}
					>
						{localeLabels[l]}
					</button>
				</span>
			))}
		</div>
	);
}
