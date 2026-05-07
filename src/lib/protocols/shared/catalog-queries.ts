/**
 * Saleor GraphQL queries for the UCP catalog REST endpoints (Phase A5).
 *
 * Uses the saleorQuery raw-string pattern (no codegen) to keep the protocol
 * layer independent from the main storefront's typed query layer.
 */

/** Common product fragment used by search and detail queries */
export const CATALOG_PRODUCT_FRAGMENT = `
  fragment CatalogProduct on Product {
    id
    name
    slug
    description
    isAvailable
    isAvailableForPurchase
    category {
      id
      name
      slug
    }
    pricing {
      priceRange {
        start {
          gross {
            amount
            currency
          }
        }
        stop {
          gross {
            amount
            currency
          }
        }
      }
    }
    media {
      url
      alt
      type
    }
    defaultVariant {
      id
      sku
    }
    variants {
      id
      name
      sku
      quantityAvailable
      pricing {
        price {
          gross {
            amount
            currency
          }
        }
      }
      attributes {
        attribute {
          slug
          name
        }
        values {
          name
          slug
        }
      }
      preorder {
        endDate
      }
    }
    attributes {
      attribute {
        slug
        name
      }
      values {
        name
        slug
      }
    }
  }
`;

/** Search products with optional filters and cursor pagination */
export const CATALOG_SEARCH_QUERY = `
  ${CATALOG_PRODUCT_FRAGMENT}
  query ProtocolCatalogSearch(
    $channel: String!
    $first: Int!
    $after: String
    $filter: ProductFilterInput
  ) {
    products(channel: $channel, first: $first, after: $after, filter: $filter) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          ...CatalogProduct
        }
      }
    }
  }
`;

/** Fetch a product by slug for the public detail endpoint */
export const CATALOG_PRODUCT_BY_SLUG_QUERY = `
  ${CATALOG_PRODUCT_FRAGMENT}
  query ProtocolCatalogProductBySlug($slug: String!, $channel: String!) {
    product(slug: $slug, channel: $channel) {
      ...CatalogProduct
    }
  }
`;

/** List categories with product counts (channel-scoped) */
export const CATALOG_CATEGORIES_QUERY = `
  query ProtocolCatalogCategories($first: Int!, $channel: String!) {
    categories(first: $first, level: 0) {
      edges {
        node {
          id
          name
          slug
          description
          children(first: 50) {
            edges {
              node {
                id
                name
                slug
              }
            }
          }
          products(channel: $channel, first: 0) {
            totalCount
          }
        }
      }
    }
  }
`;

// -------------------------------------------------------------------
// Saleor response types (consumed by saleorQuery generic + catalog-mapper)
// -------------------------------------------------------------------

export interface SaleorMoney {
	amount: number;
	currency: string;
}

export interface SaleorMedia {
	url: string;
	alt: string | null;
	type: string;
}

export interface SaleorAttribute {
	attribute: { slug: string; name: string };
	values: Array<{ name: string; slug: string }>;
}

export interface SaleorCatalogVariant {
	id: string;
	name: string;
	sku: string | null;
	quantityAvailable: number | null;
	pricing: { price: { gross: SaleorMoney } } | null;
	attributes: SaleorAttribute[];
	preorder: { endDate: string | null } | null;
}

export interface SaleorCatalogProduct {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	isAvailable: boolean;
	isAvailableForPurchase: boolean;
	category: { id: string; name: string; slug: string } | null;
	pricing: {
		priceRange: {
			start: { gross: SaleorMoney };
			stop: { gross: SaleorMoney };
		};
	} | null;
	media: SaleorMedia[];
	defaultVariant: { id: string; sku: string | null } | null;
	variants: SaleorCatalogVariant[];
	attributes: SaleorAttribute[];
}

export interface CatalogSearchData {
	products: {
		totalCount: number;
		pageInfo: {
			hasNextPage: boolean;
			endCursor: string | null;
		};
		edges: Array<{ node: SaleorCatalogProduct }>;
	};
}

export interface CatalogProductBySlugData {
	product: SaleorCatalogProduct | null;
}

export interface SaleorCategoryNode {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	children: { edges: Array<{ node: { id: string; name: string; slug: string } }> };
	products: { totalCount: number };
}

export interface CatalogCategoriesData {
	categories: {
		edges: Array<{ node: SaleorCategoryNode }>;
	};
}
