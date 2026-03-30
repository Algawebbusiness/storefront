"use client";

import { useState, type FC } from "react";
import { Building } from "lucide-react";
import { useTranslations } from "next-intl";
import { FieldError } from "@/checkout/views/saleor-checkout/address-form-fields";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { cn } from "@/lib/utils";
import { validateICO, validateDIC } from "@/checkout/lib/validators/czech";

interface CzechBusinessFieldsProps {
	countryCode: string;
	companyName: string;
	ico: string;
	dic: string;
	onIcoChange: (value: string) => void;
	onDicChange: (value: string) => void;
	errors: Record<string, string>;
}

/**
 * IČO and DIČ input fields for Czech company addresses.
 * Only renders when countryCode is "CZ" and companyName is non-empty.
 */
export const CzechBusinessFields: FC<CzechBusinessFieldsProps> = ({
	countryCode,
	companyName,
	ico,
	dic,
	onIcoChange,
	onDicChange,
	errors,
}) => {
	const t = useTranslations("checkout");
	const tc = useTranslations("common");
	const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

	// Only show for Czech company addresses
	if (countryCode !== "CZ" || !companyName.trim()) {
		return null;
	}

	const handleIcoBlur = () => {
		if (ico && !validateICO(ico)) {
			setLocalErrors((prev) => ({ ...prev, ico: t("icoInvalid") }));
		} else {
			setLocalErrors((prev) => ({ ...prev, ico: "" }));
		}
	};

	const handleDicBlur = () => {
		if (dic && !validateDIC(dic)) {
			setLocalErrors((prev) => ({ ...prev, dic: t("dicInvalid") }));
		} else {
			setLocalErrors((prev) => ({ ...prev, dic: "" }));
		}
	};

	const icoError = errors.ico || localErrors.ico;
	const dicError = errors.dic || localErrors.dic;

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div className="space-y-1.5">
				<Label htmlFor="ico" className="text-sm font-medium">
					{t("ico")}
				</Label>
				<div className="relative">
					<Building className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="ico"
						placeholder={t("icoPlaceholder")}
						value={ico}
						onChange={(e) => {
							onIcoChange(e.target.value);
							if (localErrors.ico) setLocalErrors((prev) => ({ ...prev, ico: "" }));
						}}
						onBlur={handleIcoBlur}
						maxLength={8}
						className={cn("h-12 pl-10", icoError && "border-destructive")}
					/>
				</div>
				<FieldError error={icoError} />
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="dic" className="text-sm font-medium">
					{t("dic")}
					<span className="ml-1 font-normal text-muted-foreground">{tc("optional")}</span>
				</Label>
				<div className="relative">
					<Building className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						id="dic"
						placeholder={t("dicPlaceholder")}
						value={dic}
						onChange={(e) => {
							onDicChange(e.target.value);
							if (localErrors.dic) setLocalErrors((prev) => ({ ...prev, dic: "" }));
						}}
						onBlur={handleDicBlur}
						maxLength={12}
						className={cn("h-12 pl-10", dicError && "border-destructive")}
					/>
				</div>
				<FieldError error={dicError} />
			</div>
		</div>
	);
};
