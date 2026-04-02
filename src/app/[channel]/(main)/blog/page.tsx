import { type Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isPayloadConfigured, getPayloadMediaUrl } from "@/lib/payload/client";
import { getPublishedPosts } from "@/lib/payload/queries";
import type { PayloadPost, PayloadMedia } from "@/lib/payload/types";
import { buildPageMetadata, buildBreadcrumbListJsonLd } from "@/lib/seo";
import { formatDate } from "@/config/locale";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("blog");
	return buildPageMetadata({
		title: t("title"),
		description: t("subtitle"),
	});
}

export default async function BlogPage(props: {
	params: Promise<{ channel: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	if (!isPayloadConfigured()) {
		notFound();
	}

	const [params, searchParams, t] = await Promise.all([
		props.params,
		props.searchParams,
		getTranslations("blog"),
	]);

	const page = parseInt(searchParams.page || "1", 10);
	const posts = await getPublishedPosts(page, 12);

	const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
		{ name: t("home"), url: `/${params.channel}` },
		{ name: t("title"), url: `/${params.channel}/blog` },
	]);

	return (
		<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
			{breadcrumbJsonLd && (
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
				/>
			)}

			<div className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
				<p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
			</div>

			{!posts || posts.docs.length === 0 ? (
				<div className="rounded-lg border border-dashed p-12 text-center">
					<p className="text-lg font-medium">{t("noPosts")}</p>
					<p className="mt-2 text-sm text-muted-foreground">{t("noPostsDescription")}</p>
				</div>
			) : (
				<>
					<div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
						{posts.docs.map((post) => (
							<BlogPostCard key={post.id} post={post} channel={params.channel} />
						))}
					</div>

					{/* Pagination */}
					{posts.totalPages > 1 && (
						<nav className="mt-12 flex justify-center gap-2">
							{posts.hasPrevPage && (
								<Link
									href={`/${params.channel}/blog?page=${page - 1}`}
									className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
								>
									&laquo;
								</Link>
							)}
							{Array.from({ length: posts.totalPages }, (_, i) => (
								<Link
									key={i + 1}
									href={`/${params.channel}/blog?page=${i + 1}`}
									className={`rounded-md border px-4 py-2 text-sm ${
										i + 1 === page
											? "border-foreground bg-foreground text-background"
											: "border-border hover:bg-secondary"
									}`}
								>
									{i + 1}
								</Link>
							))}
							{posts.hasNextPage && (
								<Link
									href={`/${params.channel}/blog?page=${page + 1}`}
									className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
								>
									&raquo;
								</Link>
							)}
						</nav>
					)}
				</>
			)}
		</div>
	);
}

function BlogPostCard({ post, channel }: { post: PayloadPost; channel: string }) {
	const coverImage = typeof post.coverImage === "object" ? (post.coverImage as PayloadMedia) : null;
	const dateStr = formatDate(new Date(post.publishedAt));

	return (
		<Link
			href={`/${channel}/blog/${post.slug}`}
			className="group block overflow-hidden rounded-lg border border-border transition-colors hover:border-foreground/20"
		>
			{coverImage?.url && (
				<div className="relative aspect-[16/9] overflow-hidden bg-muted">
					<Image
						src={getPayloadMediaUrl(coverImage.url)}
						alt={coverImage.alt ?? post.title}
						fill
						className="object-cover transition-transform duration-300 group-hover:scale-105"
					/>
				</div>
			)}
			<div className="p-4">
				<p className="mb-1 text-xs text-muted-foreground">{dateStr}</p>
				<h2 className="font-semibold leading-tight group-hover:underline">{post.title}</h2>
				{post.excerpt && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>}
			</div>
		</Link>
	);
}
