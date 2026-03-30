import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { DraftModeNotification } from "@/ui/components/draft-mode-notification";
import { rootMetadata } from "@/lib/seo";
import { SpeedInsights } from "@vercel/speed-insights/next";

/**
 * Root metadata for the entire site.
 * Configuration is in src/lib/seo/config.ts
 */
export const metadata = rootMetadata;

export default async function RootLayout(props: { children: ReactNode }) {
	const { children } = props;
	const locale = await getLocale();

	return (
		<html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} min-h-dvh`}>
			<body className="min-h-dvh font-sans">
				{children}
				<Suspense>
					<DraftModeNotification />
				</Suspense>
				<SpeedInsights />
			</body>
		</html>
	);
}
