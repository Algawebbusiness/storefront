/**
 * Czech business number validation utilities.
 *
 * IČO (Identification Number of Organization) — 8-digit number with modulo 11 checksum.
 * DIČ (Tax Identification Number) — "CZ" prefix followed by 8-10 digits.
 */

/**
 * Validate Czech IČO (company identification number).
 * Must be exactly 8 digits with valid modulo 11 checksum.
 */
export function validateICO(value: string): boolean {
	const trimmed = value.trim();

	// Must be exactly 8 digits
	if (!/^\d{8}$/.test(trimmed)) {
		return false;
	}

	// Modulo 11 checksum validation
	const digits = trimmed.split("").map(Number);
	const weights = [8, 7, 6, 5, 4, 3, 2];

	let sum = 0;
	for (let i = 0; i < 7; i++) {
		sum += digits[i] * weights[i];
	}

	const remainder = sum % 11;
	let expectedCheck: number;

	if (remainder === 0) {
		expectedCheck = 1;
	} else if (remainder === 1) {
		expectedCheck = 0;
	} else {
		expectedCheck = 11 - remainder;
	}

	return digits[7] === expectedCheck;
}

/**
 * Validate Czech DIČ (tax identification number).
 * Must match format: CZ followed by 8-10 digits.
 */
export function validateDIC(value: string): boolean {
	const trimmed = value.trim();
	return /^CZ\d{8,10}$/.test(trimmed);
}
