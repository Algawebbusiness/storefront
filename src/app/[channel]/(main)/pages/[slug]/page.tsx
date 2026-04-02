import { notFound } from "next/navigation";
import { type Metadata } from "next";
import edjsHTML from "editorjs-html";
import xss from "xss";
import { PageGetBySlugDocument } from "@/gql/graphql";
import { executePublicGraphQL } from "@/lib/graphql";
import { getPageBySlug } from "@/lib/payload/queries";
import { PayloadRichTextRenderer } from "@/ui/components/payload-rich-text";
import { buildPageMetadata } from "@/lib/seo";

const parser = edjsHTML();

export const generateMetadata = async (props: { params: Promise<{ slug: string }> }): Promise<Metadata> => {
	const params = await props.params;

	// Try Payload first, then Saleor
	const payloadPage = await getPageBySlug(params.slug);
	if (payloadPage) {
		return buildPageMetadata({
			title: payloadPage.seoTitle || payloadPage.title,
			description: payloadPage.seoDescription,
		});
	}

	const result = await executePublicGraphQL(PageGetBySlugDocument, {
		variables: { slug: params.slug },
		revalidate: 60,
	});

	const page = result.ok ? result.data.page : null;

	return buildPageMetadata({
		title: page?.seoTitle || page?.title || "Page",
		description: page?.seoDescription || page?.seoTitle || page?.title,
	});
};

export default async function Page(props: { params: Promise<{ slug: string }> }) {
	const params = await props.params;

	// ── Try Payload CMS first ──
	const payloadPage = await getPageBySlug(params.slug);

	if (payloadPage) {
		return (
			<div className="mx-auto max-w-7xl p-8 pb-16">
				<h1 className="text-3xl font-semibold">{payloadPage.title}</h1>
				<div className="mt-6">
					<PayloadRichTextRenderer content={payloadPage.content} />
				</div>
			</div>
		);
	}

	// ── Fall back to Saleor page ──
	const result = await executePublicGraphQL(PageGetBySlugDocument, {
		variables: { slug: params.slug },
		revalidate: 60,
	});

	if (!result.ok || !result.data.page) {
		notFound();
	}

	const page = result.data.page;
	const { title, content } = page;
	const contentHtml = content ? parser.parse(JSON.parse(content)) : null;

	return (
		<div className="mx-auto max-w-7xl p-8 pb-16">
			<h1 className="text-3xl font-semibold">{title}</h1>
			{contentHtml && (
				<div className="prose mt-6">
					{contentHtml.map((html: string) => (
						<div key={html} dangerouslySetInnerHTML={{ __html: xss(html) }} />
					))}
				</div>
			)}
		</div>
	);
}
