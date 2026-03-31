/**
 * Raw GraphQL query strings for order operations in the ACP/UCP protocol layer.
 *
 * Uses the saleorQuery pattern (raw strings, no codegen) to keep
 * the protocol layer independent from the main storefront.
 */

/** Fetch an order by ID */
export const ORDER_BY_ID_QUERY = `
  query ProtocolOrderById($id: ID!) {
    order(id: $id) {
      id
      number
      status
      created
      userEmail
      isPaid
      channel {
        slug
      }
      total {
        gross {
          amount
          currency
        }
        tax {
          amount
          currency
        }
      }
      subtotal {
        gross {
          amount
          currency
        }
      }
      shippingPrice {
        gross {
          amount
          currency
        }
      }
      shippingAddress {
        firstName
        lastName
        streetAddress1
        streetAddress2
        city
        postalCode
        country {
          code
        }
        phone
      }
      billingAddress {
        firstName
        lastName
        streetAddress1
        streetAddress2
        city
        postalCode
        country {
          code
        }
        phone
      }
      lines {
        id
        productName
        variantName
        quantity
        unitPrice {
          gross {
            amount
            currency
          }
        }
        totalPrice {
          gross {
            amount
            currency
          }
        }
        thumbnail {
          url
          alt
        }
      }
      deliveryMethod {
        ... on ShippingMethod {
          name
        }
      }
      discounts {
        name
        amount {
          amount
          currency
        }
      }
      statusDisplay
    }
  }
`;

// -------------------------------------------------------------------
// Saleor response type interfaces (for use with saleorQuery generic)
// -------------------------------------------------------------------

export interface SaleorOrderAddress {
	firstName: string;
	lastName: string;
	streetAddress1: string;
	streetAddress2: string;
	city: string;
	postalCode: string;
	country: { code: string };
	phone: string;
}

export interface SaleorOrderLine {
	id: string;
	productName: string;
	variantName: string;
	quantity: number;
	unitPrice: { gross: { amount: number; currency: string } };
	totalPrice: { gross: { amount: number; currency: string } };
	thumbnail: { url: string; alt: string | null } | null;
}

export interface SaleorOrderDiscount {
	name: string | null;
	amount: { amount: number; currency: string };
}

export interface SaleorOrder {
	id: string;
	number: string;
	status: string;
	created: string;
	userEmail: string | null;
	isPaid: boolean;
	channel: { slug: string };
	total: {
		gross: { amount: number; currency: string };
		tax: { amount: number; currency: string };
	};
	subtotal: { gross: { amount: number; currency: string } };
	shippingPrice: { gross: { amount: number; currency: string } };
	shippingAddress: SaleorOrderAddress | null;
	billingAddress: SaleorOrderAddress | null;
	lines: SaleorOrderLine[];
	deliveryMethod: { name: string } | null;
	discounts: SaleorOrderDiscount[];
	statusDisplay: string;
}

export interface OrderByIdData {
	order: SaleorOrder | null;
}
