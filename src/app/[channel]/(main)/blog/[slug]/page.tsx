import { notFound } from "next/navigation";
import { type Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { isPayloadConfigured, getPayloadMediaUrl } from "@/lib/payload/client";
import { getPostBySlug } from "@/lib/payload/queries";
import type { PayloadMedia } from "@/lib/payload/types";
import { PayloadRichTextRenderer } from "@/ui/components/payload-rich-text";
import { buildPageMetadata, buildBreadcrumbListJsonLd } from "@/lib/seo";
import { Breadcrumbs } from "@/ui/components/breadcrumbs";
import { formatDate } from "@/config/locale";

export async function generateMetadata(props: {
	params: Promise<{ slug: string; channel: string }>;
}): Promise<Metadata> {
	if (!isPayloadConfigured()) return { title: "Not Found" };

	const params = await props.params;
	const post = await getPostBySlug(params.slug);

	if (!post) return { title: "Not Found" };

	const coverImage = typeof post.coverImage === "object" ? (post.coverImage as PayloadMedia) : null;

	return buildPageMetadata({
		title: post.seoTitle || post.title,
		description: post.seoDescription || post.excerpt,
		image: coverImage?.url ? getPayloadMediaUrl(coverImage.url) : undefined,
		url: `/${params.channel}/blog/${params.slug}`,
	});
}

export default async function BlogPostPage(props: {
	params: Promise<{ slug: string; channel: string }>;
}) {
	if (!isPayloadConfigured()) {
		notFound();
	}

	const [params, t] = await Promise.all([props.params, getTranslations("blog")]);
	const post = await getPostBySlug(params.slug);

	if (!post) {
		notFound();
	}

	const coverImage = typeof post.coverImage === "object" ? (post.coverImage as PayloadMedia) : null;
	const dateStr = formatDate(new Date(post.publishedAt));
	const authorName = post.author?.name;

	const breadcrumbs = [
		{ label: t("home"), href: `/${params.channel}` },
		{ label: t("title"), href: `/${params.channel}/blog` },
		{ label: post.title },
	];

	const breadcrumbJsonLd = buildBreadcrumbListJsonLd(
		breadcrumbs.map((b) => ({ name: b.label, url: "href" in b ? (b.href as string) : undefined })),
	);

	return (
		<article className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
			{breadcrumbJsonLd && (
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
				/>
			)}

			<div className="mb-6">
				<Breadcrumbs items={breadcrumbs} />
			</div>

			{/* Cover image */}
			{coverImage?.url && (
				<div className="relative mb-8 aspect-[2/1] overflow-hidden rounded-xl bg-muted">
					<Image
						src={getPayloadMediaUrl(coverImage.url)}
						alt={coverImage.alt ?? post.title}
						fill
						className="object-cover"
						priority
					/>
				</div>
			)}

			{/* Header */}
			<header className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{post.title}</h1>
				<div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
					<time dateTime={post.publishedAt}>{t("publishedOn", { date: dateStr })}</time>
					{authorName && (
						<>
							<span>&middot;</span>
							<span>{t("by", { author: authorName })}</span>
						</>
					)}
				</div>
			</header>

			{/* Content */}
			<PayloadRichTextRenderer content={post.content} />
		</article>
	);
}
