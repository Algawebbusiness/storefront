/**
 * Address format normalization between Saleor and ACP/UCP protocols.
 */

import type { ProtocolAddress, SaleorAddress } from "./types";

/** Convert Saleor address to protocol format */
export function saleorToProtocol(addr: SaleorAddress): ProtocolAddress {
	return {
		street_address: addr.streetAddress1,
		...(addr.streetAddress2 && { street_address_2: addr.streetAddress2 }),
		address_locality: addr.city,
		...(addr.countryArea && { address_region: addr.countryArea }),
		postal_code: addr.postalCode,
		address_country: addr.country,
	};
}

/** Convert protocol address to Saleor format */
export function protocolToSaleor(
	addr: ProtocolAddress,
	extra?: { firstName?: string; lastName?: string; phone?: string; companyName?: string },
): SaleorAddress {
	return {
		...(extra?.firstName && { firstName: extra.firstName }),
		...(extra?.lastName && { lastName: extra.lastName }),
		...(extra?.companyName && { companyName: extra.companyName }),
		streetAddress1: addr.street_address,
		...(addr.street_address_2 && { streetAddress2: addr.street_address_2 }),
		city: addr.address_locality,
		...(addr.address_region && { countryArea: addr.address_region }),
		postalCode: addr.postal_code,
		country: addr.address_country,
		...(extra?.phone && { phone: extra.phone }),
	};
}
