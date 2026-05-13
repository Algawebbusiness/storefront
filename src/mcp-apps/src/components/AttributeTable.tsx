/**
 * Static attribute table (Phase F5).
 *
 * Renders `attributes` (slug → string[]) as a two-column table. Multi-
 * value attributes (e.g. "tag" with several entries) are joined with
 * commas — same convention the variant attribute reducer uses on the
 * server, so single and compare modes stay consistent.
 *
 * Attribute slugs are presented in title case for the label column to
 * avoid wrapping kebab-case in front of end-users. Saleor's localised
 * attribute name (`attribute.name`) is intentionally NOT used — the
 * detail mapper currently only keeps the slug as the key. F8 may add
 * a parallel `attributeNames` map if title casing isn't enough.
 */

import type { ProductFull } from "../types";

export interface AttributeTableProps {
	attributes: ProductFull["attributes"];
}

function toLabel(slug: string): string {
	return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AttributeTable({ attributes }: AttributeTableProps) {
	const entries = Object.entries(attributes).filter(([, vals]) => vals.length > 0);
	if (entries.length === 0) return null;
	return (
		<table className="at-root">
			<tbody>
				{entries.map(([slug, vals]) => (
					<tr key={slug}>
						<th scope="row">{toLabel(slug)}</th>
						<td>{vals.join(", ")}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
