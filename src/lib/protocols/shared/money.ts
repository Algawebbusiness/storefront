/**
 * Currency minor units conversion for ACP/UCP protocols.
 *
 * Both ACP and UCP represent monetary amounts in minor units (cents).
 * Saleor uses decimal amounts. This module handles conversion.
 *
 * @example
 * toMinorUnits({ amount: 520.00, currency: "CZK" })  // → { amount: 52000, currency: "CZK" }
 * toMinorUnits({ amount: 1000, currency: "JPY" })     // → { amount: 1000, currency: "JPY" }
 * fromMinorUnits({ amount: 52000, currency: "CZK" })  // → { amount: 520.00, currency: "CZK" }
 */

import type { ProtocolMoney, SaleorMoney } from "./types";

/**
 * Currencies with non-standard decimal places.
 * Default is 2 decimal places (most currencies).
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
	"BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
	"MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** Get the number of decimal places for a currency */
export function getCurrencyDecimals(currency: string): number {
	const upper = currency.toUpperCase();
	if (ZERO_DECIMAL_CURRENCIES.has(upper)) return 0;
	if (THREE_DECIMAL_CURRENCIES.has(upper)) return 3;
	return 2;
}

/** Convert Saleor decimal amount to protocol minor units */
export function toMinorUnits(saleorMoney: SaleorMoney): ProtocolMoney {
	const decimals = getCurrencyDecimals(saleorMoney.currency);
	const factor = Math.pow(10, decimals);
	return {
		amount: Math.round(saleorMoney.amount * factor),
		currency: saleorMoney.currency,
	};
}

/** Convert protocol minor units back to Saleor decimal amount */
export function fromMinorUnits(protocolMoney: ProtocolMoney): SaleorMoney {
	const decimals = getCurrencyDecimals(protocolMoney.currency);
	const factor = Math.pow(10, decimals);
	return {
		amount: protocolMoney.amount / factor,
		currency: protocolMoney.currency,
	};
}
