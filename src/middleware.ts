import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware that sets NEXT_LOCALE cookie if not present.
 * We do NOT use URL-based locale prefixes because [channel] already occupies
 * the first URL segment.
 */
export function middleware(request: NextRequest) {
	const response = NextResponse.next();

	// If no locale cookie, detect from Accept-Language and set it
	if (!request.cookies.has("NEXT_LOCALE")) {
		const acceptLanguage = request.headers.get("accept-language") || "";
		const prefersCzech = acceptLanguage.toLowerCase().includes("cs");
		const locale = prefersCzech ? "cs" : "en";
		response.cookies.set("NEXT_LOCALE", locale, {
			path: "/",
			maxAge: 60 * 60 * 24 * 365, // 1 year
			sameSite: "lax",
		});
	}

	return response;
}

export const config = {
	// Match all routes except static files, API routes, and Next.js internals
	matcher: ["/((?!api|_next|.*\\..*).*)"],
};
