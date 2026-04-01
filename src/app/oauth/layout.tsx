import { type ReactNode } from "react";
import { Logo } from "@/ui/components/shared/logo";
import { brandConfig } from "@/config/brand";

/**
 * OAuth layout — minimal, focused on authorization flow.
 * No header/footer/cart — just logo and content on a clean background.
 */
export default function OAuthLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-dvh flex-col bg-background">
			{/* Minimal header with logo */}
			<header className="border-b border-border px-4 py-4">
				<div className="mx-auto max-w-md">
					<Logo className="h-6 w-auto" />
				</div>
			</header>

			{/* Content */}
			<main className="flex-1 px-4">{children}</main>

			{/* Minimal footer */}
			<footer className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">
				{brandConfig.copyrightHolder}
			</footer>
		</div>
	);
}
