/**
 * Raw GraphQL query strings for the ACP/UCP checkout protocol layer.
 *
 * Uses the saleorQuery pattern (raw strings, no codegen) to keep
 * the protocol layer independent from the main storefront.
 */

/** Comprehensive checkout fragment for protocol responses */
export const CHECKOUT_FRAGMENT = `
  fragment ProtocolCheckout on Checkout {
    id
    email
    channel {
      id
      slug
    }
    lines {
      id
      quantity
      totalPrice {
        gross {
          amount
          currency
        }
      }
      unitPrice {
        gross {
          amount
          currency
        }
      }
      variant {
        id
        name
        sku
        product {
          id
          name
          slug
          thumbnail(size: 256, format: WEBP) {
            url
          }
          media {
            url
            type
          }
        }
      }
    }
    totalPrice {
      gross {
        amount
        currency
      }
      tax {
        amount
        currency
      }
    }
    subtotalPrice {
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
    discount {
      amount
      currency
    }
    shippingAddress {
      firstName
      lastName
      companyName
      streetAddress1
      streetAddress2
      city
      cityArea
      postalCode
      country {
        code
        country
      }
      countryArea
      phone
    }
    billingAddress {
      firstName
      lastName
      companyName
      streetAddress1
      streetAddress2
      city
      cityArea
      postalCode
      country {
        code
        country
      }
      countryArea
      phone
    }
    deliveryMethod {
      ... on ShippingMethod {
        id
        name
      }
      ... on Warehouse {
        id
        name
      }
    }
    shippingMethods {
      id
      name
      price {
        amount
        currency
      }
      minimumDeliveryDays
      maximumDeliveryDays
    }
    isShippingRequired
    authorizeStatus
    chargeStatus
  }
`;

/** Fetch a checkout by ID */
export const CHECKOUT_BY_ID_QUERY = `
  ${CHECKOUT_FRAGMENT}
  query ProtocolCheckoutById($id: ID!) {
    checkout(id: $id) {
      ...ProtocolCheckout
    }
  }
`;

/** Create a new checkout */
export const CHECKOUT_CREATE_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutCreate($input: CheckoutCreateInput!) {
    checkoutCreate(input: $input) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Add lines to a checkout */
export const CHECKOUT_LINES_ADD_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutLinesAdd($id: ID!, $lines: [CheckoutLineInput!]!) {
    checkoutLinesAdd(id: $id, lines: $lines) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Update checkout email */
export const CHECKOUT_EMAIL_UPDATE_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutEmailUpdate($id: ID!, $email: String!) {
    checkoutEmailUpdate(id: $id, email: $email) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Update shipping address */
export const CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutShippingAddressUpdate($id: ID!, $shippingAddress: AddressInput!) {
    checkoutShippingAddressUpdate(id: $id, shippingAddress: $shippingAddress) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Update billing address */
export const CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutBillingAddressUpdate($id: ID!, $billingAddress: AddressInput!) {
    checkoutBillingAddressUpdate(id: $id, billingAddress: $billingAddress) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Update delivery method */
export const CHECKOUT_DELIVERY_METHOD_UPDATE_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutDeliveryMethodUpdate($id: ID!, $deliveryMethodId: ID!) {
    checkoutDeliveryMethodUpdate(id: $id, deliveryMethodId: $deliveryMethodId) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Add promo code */
export const CHECKOUT_ADD_PROMO_CODE_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutAddPromoCode($checkoutId: ID, $promoCode: String!) {
    checkoutAddPromoCode(checkoutId: $checkoutId, promoCode: $promoCode) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Remove promo code */
export const CHECKOUT_REMOVE_PROMO_CODE_MUTATION = `
  ${CHECKOUT_FRAGMENT}
  mutation ProtocolCheckoutRemovePromoCode($checkoutId: ID, $promoCode: String) {
    checkoutRemovePromoCode(checkoutId: $checkoutId, promoCode: $promoCode) {
      checkout {
        ...ProtocolCheckout
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Complete checkout */
export const CHECKOUT_COMPLETE_MUTATION = `
  mutation ProtocolCheckoutComplete($checkoutId: ID!) {
    checkoutComplete(id: $checkoutId) {
      order {
        id
        number
        status
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Initialize a payment transaction */
export const TRANSACTION_INITIALIZE_MUTATION = `
  mutation ProtocolTransactionInitialize(
    $checkoutId: ID!
    $paymentGateway: PaymentGatewayToInitialize!
    $amount: PositiveDecimal
  ) {
    transactionInitialize(
      id: $checkoutId
      paymentGateway: $paymentGateway
      amount: $amount
    ) {
      transaction {
        id
        status
      }
      data
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Process a payment transaction */
export const TRANSACTION_PROCESS_MUTATION = `
  mutation ProtocolTransactionProcess($transactionId: ID!, $data: JSON) {
    transactionProcess(id: $transactionId, data: $data) {
      transaction {
        id
        status
      }
      data
      errors {
        field
        message
        code
      }
    }
  }
`;

// -------------------------------------------------------------------
// Saleor response type interfaces (for use with saleorQuery generic)
// -------------------------------------------------------------------

export interface SaleorCheckoutAddress {
	firstName: string;
	lastName: string;
	companyName: string;
	streetAddress1: string;
	streetAddress2: string;
	city: string;
	cityArea: string;
	postalCode: string;
	country: { code: string; country: string };
	countryArea: string;
	phone: string;
}

export interface SaleorCheckoutLine {
	id: string;
	quantity: number;
	totalPrice: { gross: { amount: number; currency: string } };
	unitPrice: { gross: { amount: number; currency: string } };
	variant: {
		id: string;
		name: string;
		sku: string | null;
		product: {
			id: string;
			name: string;
			slug: string;
			thumbnail: { url: string } | null;
			media: Array<{ url: string; type: string }>;
		};
	};
}

export interface SaleorShippingMethod {
	id: string;
	name: string;
	price: { amount: number; currency: string };
	minimumDeliveryDays: number | null;
	maximumDeliveryDays: number | null;
}

export interface SaleorCheckout {
	id: string;
	email: string | null;
	channel: { id: string; slug: string };
	lines: SaleorCheckoutLine[];
	totalPrice: {
		gross: { amount: number; currency: string };
		tax: { amount: number; currency: string };
	};
	subtotalPrice: { gross: { amount: number; currency: string } };
	shippingPrice: { gross: { amount: number; currency: string } };
	discount: { amount: number; currency: string } | null;
	shippingAddress: SaleorCheckoutAddress | null;
	billingAddress: SaleorCheckoutAddress | null;
	deliveryMethod: { id: string; name: string } | null;
	shippingMethods: SaleorShippingMethod[];
	isShippingRequired: boolean;
	authorizeStatus: string;
	chargeStatus: string;
}

export interface SaleorCheckoutError {
	field: string | null;
	message: string;
	code: string;
}

export interface CheckoutByIdData {
	checkout: SaleorCheckout | null;
}

export interface CheckoutCreateData {
	checkoutCreate: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutLinesAddData {
	checkoutLinesAdd: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutEmailUpdateData {
	checkoutEmailUpdate: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutShippingAddressUpdateData {
	checkoutShippingAddressUpdate: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutBillingAddressUpdateData {
	checkoutBillingAddressUpdate: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutDeliveryMethodUpdateData {
	checkoutDeliveryMethodUpdate: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutAddPromoCodeData {
	checkoutAddPromoCode: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutRemovePromoCodeData {
	checkoutRemovePromoCode: {
		checkout: SaleorCheckout | null;
		errors: SaleorCheckoutError[];
	};
}

export interface CheckoutCompleteData {
	checkoutComplete: {
		order: { id: string; number: string; status: string } | null;
		errors: SaleorCheckoutError[];
	};
}

export interface TransactionInitializeData {
	transactionInitialize: {
		transaction: { id: string; status: string } | null;
		data: unknown;
		errors: SaleorCheckoutError[];
	};
}

export interface TransactionProcessData {
	transactionProcess: {
		transaction: { id: string; status: string } | null;
		data: unknown;
		errors: SaleorCheckoutError[];
	};
}
