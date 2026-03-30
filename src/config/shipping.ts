export const shippingConfig = {
	zasilkovna: {
		methodPattern: /zásilkovna|packeta|zásielkovňa/i,
		apiKey: process.env.NEXT_PUBLIC_ZASILKOVNA_API_KEY || "",
		widgetUrl: "https://widget.packeta.com/v6/www/js/library.js",
	},
} as const;

export function isZasilkovnaMethod(methodName: string): boolean {
	return shippingConfig.zasilkovna.methodPattern.test(methodName);
}
