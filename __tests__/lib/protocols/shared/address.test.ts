import { describe, it, expect } from "vitest";
import { saleorToProtocol, protocolToSaleor } from "@/lib/protocols/shared/address";
import type { SaleorAddress, ProtocolAddress } from "@/lib/protocols/shared/types";

describe("Address mapping — saleorToProtocol", () => {
	it("maps all fields correctly", () => {
		const saleor: SaleorAddress = {
			firstName: "Jan",
			lastName: "Novak",
			streetAddress1: "Hlavni 123",
			streetAddress2: "3. patro",
			city: "Praha",
			postalCode: "11000",
			country: "CZ",
			countryArea: "Hlavni mesto Praha",
			phone: "+420123456789",
		};

		const result = saleorToProtocol(saleor);

		expect(result.street_address).toBe("Hlavni 123");
		expect(result.street_address_2).toBe("3. patro");
		expect(result.address_locality).toBe("Praha");
		expect(result.postal_code).toBe("11000");
		expect(result.address_country).toBe("CZ");
		expect(result.address_region).toBe("Hlavni mesto Praha");
	});

	it("omits optional fields when not present", () => {
		const saleor: SaleorAddress = {
			streetAddress1: "Hlavni 123",
			city: "Praha",
			postalCode: "11000",
			country: "CZ",
		};

		const result = saleorToProtocol(saleor);

		expect(result.street_address).toBe("Hlavni 123");
		expect(result).not.toHaveProperty("street_address_2");
		expect(result).not.toHaveProperty("address_region");
	});
});

describe("Address mapping — protocolToSaleor", () => {
	it("maps all fields correctly", () => {
		const protocol: ProtocolAddress = {
			street_address: "Main St 42",
			street_address_2: "Suite B",
			address_locality: "New York",
			address_region: "NY",
			postal_code: "10001",
			address_country: "US",
		};

		const result = protocolToSaleor(protocol, {
			firstName: "John",
			lastName: "Doe",
			phone: "+1234567890",
			companyName: "Acme Inc",
		});

		expect(result.streetAddress1).toBe("Main St 42");
		expect(result.streetAddress2).toBe("Suite B");
		expect(result.city).toBe("New York");
		expect(result.countryArea).toBe("NY");
		expect(result.postalCode).toBe("10001");
		expect(result.country).toBe("US");
		expect(result.firstName).toBe("John");
		expect(result.lastName).toBe("Doe");
		expect(result.phone).toBe("+1234567890");
		expect(result.companyName).toBe("Acme Inc");
	});

	it("omits optional fields when not present", () => {
		const protocol: ProtocolAddress = {
			street_address: "Main St 42",
			address_locality: "New York",
			postal_code: "10001",
			address_country: "US",
		};

		const result = protocolToSaleor(protocol);

		expect(result.streetAddress1).toBe("Main St 42");
		expect(result.city).toBe("New York");
		expect(result).not.toHaveProperty("streetAddress2");
		expect(result).not.toHaveProperty("countryArea");
		expect(result).not.toHaveProperty("firstName");
		expect(result).not.toHaveProperty("phone");
	});
});

describe("Address round-trip", () => {
	it("saleorToProtocol -> protocolToSaleor preserves core address data", () => {
		const original: SaleorAddress = {
			streetAddress1: "Karlova 5",
			streetAddress2: "Apt 2",
			city: "Brno",
			postalCode: "60200",
			country: "CZ",
			countryArea: "Jihomoravsky kraj",
		};

		const protocol = saleorToProtocol(original);
		const roundTripped = protocolToSaleor(protocol);

		expect(roundTripped.streetAddress1).toBe(original.streetAddress1);
		expect(roundTripped.streetAddress2).toBe(original.streetAddress2);
		expect(roundTripped.city).toBe(original.city);
		expect(roundTripped.postalCode).toBe(original.postalCode);
		expect(roundTripped.country).toBe(original.country);
		expect(roundTripped.countryArea).toBe(original.countryArea);
	});
});
