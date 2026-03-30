import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { LinkWithChannel } from "../atoms/link-with-channel";
import { ChannelSelect } from "./channel-select";
import { ChannelsListDocument, MenuGetBySlugDocument } from "@/gql/graphql";
import { executePublicGraphQL } from "@/lib/graphql";
import { CopyrightText } from "./copyright-text";
import { Logo } from "./shared/logo";

/** Cached channels list - rarely changes */
async function getChannels() {
	"use cache";
	cacheLife("days"); // Cache for 1 day
	cacheTag("channels");

	if (!process.env.SALEOR_APP_TOKEN) {
		return null;
	}

	const result = await executePublicGraphQL(ChannelsListDocument, {
		headers: {
			Authorization: `Bearer ${process.env.SALEOR_APP_TOKEN}`,
		},
	});

	return result.ok ? result.data : null;
}

/** Cached footer menu */
async function getFooterMenu(channel: string) {
	"use cache";
	cacheLife("hours"); // Cache for 1 hour
	cacheTag("footer-menu");

	const result = await executePublicGraphQL(MenuGetBySlugDocument, {
		variables: { slug: "footer", channel },
		revalidate: 60 * 60 * 24,
	});

	return result.ok ? result.data : null;
}

export async function Footer({ channel }: { channel: string }) {
	const [footerLinks, channels, t] = await Promise.all([getFooterMenu(channel), getChannels(), getTranslations("footer")]);

	const menuItems = footerLinks?.menu?.items || [];

	return (
		<footer className="bg-foreground text-background">
			{/* Extra bottom padding on mobile to account for sticky add-to-cart bar */}
			<div className="mx-auto max-w-7xl px-4 pb-24 pt-12 sm:px-6 sm:pb-12 lg:px-8 lg:py-16">
				<div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:gap-12">
					{/* Brand */}
					<div className="col-span-2 md:col-span-1">
						<Link href={`/${channel}`} prefetch={false} className="mb-4 inline-block">
							<Logo className="h-7 w-auto" inverted />
						</Link>
						<p className="mt-4 max-w-xs text-sm leading-relaxed text-neutral-400">
							{t("brandTagline")}
						</p>
					</div>

					{/* Dynamic menu items from Saleor CMS */}
					{menuItems.map((item) => (
						<div key={item.id}>
							<h4 className="mb-4 text-sm font-medium text-neutral-300">{item.name}</h4>
							<ul className="space-y-3">
								{item.children?.map((child) => {
									if (child.category) {
										return (
											<li key={child.id}>
												<LinkWithChannel
													href={`/categories/${child.category.slug}`}
													prefetch={false}
													className="text-sm text-neutral-400 transition-colors hover:text-neutral-200"
												>
													{child.category.name}
												</LinkWithChannel>
											</li>
										);
									}
									if (child.collection) {
										return (
											<li key={child.id}>
												<LinkWithChannel
													href={`/collections/${child.collection.slug}`}
													prefetch={false}
													className="text-sm text-neutral-400 transition-colors hover:text-neutral-200"
												>
													{child.collection.name}
												</LinkWithChannel>
											</li>
										);
									}
									if (child.page) {
										return (
											<li key={child.id}>
												<LinkWithChannel
													href={`/pages/${child.page.slug}`}
													prefetch={false}
													className="text-sm text-neutral-400 transition-colors hover:text-neutral-200"
												>
													{child.page.title}
												</LinkWithChannel>
											</li>
										);
									}
									if (child.url) {
										return (
											<li key={child.id}>
												<Link
													href={child.url}
													prefetch={false}
													className="text-sm text-neutral-400 transition-colors hover:text-neutral-200"
												>
													{child.name}
												</Link>
											</li>
										);
									}
									return null;
								})}
							</ul>
						</div>
					))}

					{/* Static Support links (if no CMS data) */}
					{menuItems.length === 0 && (
						<>
							<div>
								<h4 className="mb-4 text-sm font-medium text-neutral-300">{t("support")}</h4>
								<ul className="space-y-3">
									{([
										{ key: "contactUs", href: "/contact" },
										{ key: "faqs", href: "/faq" },
										{ key: "shipping", href: "/shipping" },
										{ key: "returns", href: "/returns" },
									] as const).map((link) => (
										<li key={link.href}>
											<Link
												href={link.href}
												prefetch={false}
												className="text-sm text-neutral-400 transition-colors hover:text-neutral-200"
											>
												{t(link.key)}
											</Link>
										</li>
									))}
								</ul>
							</div>
							<div>
								<h4 className="mb-4 text-sm font-medium text-neutral-300">{t("company")}</h4>
								<ul className="space-y-3">
									{([
										{ key: "about", href: "/about" },
										{ key: "sustainability", href: "/sustainability" },
										{ key: "careers", href: "/careers" },
										{ key: "press", href: "/press" },
									] as const).map((link) => (
										<li key={link.href}>
											<Link
												href={link.href}
												prefetch={false}
												className="text-sm text-neutral-400 transition-colors hover:text-neutral-200"
											>
												{t(link.key)}
											</Link>
										</li>
									))}
								</ul>
							</div>
						</>
					)}
				</div>

				{/* Channel selector */}
				{channels?.channels && (
					<div className="mt-8 text-neutral-400">
						<label className="flex items-center gap-2 text-sm">
							<span>{t("changeCurrency")}</span>
							<ChannelSelect channels={channels.channels} />
						</label>
					</div>
				)}

				{/* Bottom bar */}
				<div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-neutral-800 pt-8 sm:flex-row">
					<p className="text-xs text-neutral-500">
						<CopyrightText />
					</p>
					<div className="flex items-center gap-6">
						<Link
							href="/privacy"
							prefetch={false}
							className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
						>
							{t("privacyPolicy")}
						</Link>
						<Link
							href="/terms"
							prefetch={false}
							className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
						>
							{t("termsOfService")}
						</Link>
					</div>
				</div>
			</div>
		</footer>
	);
}
