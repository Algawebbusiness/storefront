/**
 * Payload CMS Lexical RichText renderer.
 *
 * Renders Payload 3.x Lexical editor output as HTML using React components.
 * Handles: headings, paragraphs, lists, links, images, code, blockquotes.
 * Uses Tailwind prose classes for typography.
 */

import Image from "next/image";
import Link from "next/link";
import type { PayloadRichText, PayloadRichTextNode, PayloadMedia } from "@/lib/payload/types";
import { getPayloadMediaUrl } from "@/lib/payload/client";

interface PayloadRichTextProps {
	content: PayloadRichText | null | undefined;
	className?: string;
}

export function PayloadRichTextRenderer({ content, className }: PayloadRichTextProps) {
	if (!content?.root?.children) return null;

	return (
		<div className={className ?? "prose prose-neutral max-w-none dark:prose-invert"}>
			{content.root.children.map((node, i) => (
				<RichTextNode key={i} node={node} />
			))}
		</div>
	);
}

function RichTextNode({ node }: { node: PayloadRichTextNode }) {
	switch (node.type) {
		case "paragraph":
			return (
				<p>
					<InlineChildren nodes={node.children} />
				</p>
			);

		case "heading": {
			const Tag = (node.tag ?? "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
			return (
				<Tag>
					<InlineChildren nodes={node.children} />
				</Tag>
			);
		}

		case "list": {
			const Tag = node.listType === "number" ? "ol" : "ul";
			return (
				<Tag>
					{node.children?.map((item, i) => (
						<li key={i}>
							<InlineChildren nodes={item.children} />
						</li>
					))}
				</Tag>
			);
		}

		case "listitem":
			return (
				<li>
					<InlineChildren nodes={node.children} />
				</li>
			);

		case "quote":
			return (
				<blockquote>
					<InlineChildren nodes={node.children} />
				</blockquote>
			);

		case "code":
			return (
				<pre>
					<code>
						<InlineChildren nodes={node.children} />
					</code>
				</pre>
			);

		case "upload": {
			const media = node.value as PayloadMedia | undefined;
			if (!media?.url) return null;
			return (
				<figure>
					<Image
						src={getPayloadMediaUrl(media.url)}
						alt={media.alt ?? ""}
						width={media.width ?? 800}
						height={media.height ?? 450}
						className="rounded-lg"
					/>
					{media.alt && <figcaption>{media.alt}</figcaption>}
				</figure>
			);
		}

		case "horizontalrule":
			return <hr />;

		default:
			// Unknown block type — render children if any
			if (node.children?.length) {
				return (
					<div>
						<InlineChildren nodes={node.children} />
					</div>
				);
			}
			return null;
	}
}

function InlineChildren({ nodes }: { nodes: PayloadRichTextNode[] | undefined }) {
	if (!nodes) return null;
	return (
		<>
			{nodes.map((node, i) => (
				<InlineNode key={i} node={node} />
			))}
		</>
	);
}

function InlineNode({ node }: { node: PayloadRichTextNode }) {
	// Text node
	if (node.type === "text" && node.text !== undefined) {
		return <TextNode text={node.text} format={node.format} />;
	}

	// Link
	if (node.type === "link" || node.type === "autolink") {
		const href = node.url ?? "#";
		const isExternal = href.startsWith("http");
		if (isExternal) {
			return (
				<a href={href} target={node.newTab ? "_blank" : undefined} rel={node.newTab ? "noopener noreferrer" : undefined}>
					<InlineChildren nodes={node.children} />
				</a>
			);
		}
		return (
			<Link href={href}>
				<InlineChildren nodes={node.children} />
			</Link>
		);
	}

	// Line break
	if (node.type === "linebreak") {
		return <br />;
	}

	// Fallback: render children
	if (node.children?.length) {
		return <InlineChildren nodes={node.children} />;
	}

	return null;
}

/**
 * Text formatting.
 * Lexical uses bitmask format: 1=bold, 2=italic, 4=strikethrough, 8=underline, 16=code
 */
function TextNode({ text, format }: { text: string; format?: number }) {
	if (!format) return <>{text}</>;

	let result: React.ReactNode = text;

	if (format & 16) result = <code>{result}</code>;
	if (format & 1) result = <strong>{result}</strong>;
	if (format & 2) result = <em>{result}</em>;
	if (format & 4) result = <s>{result}</s>;
	if (format & 8) result = <u>{result}</u>;

	return <>{result}</>;
}
