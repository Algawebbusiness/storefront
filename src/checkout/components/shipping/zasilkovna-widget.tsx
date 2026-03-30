"use client";

import { useEffect, useRef, type FC } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { useTranslations } from "next-intl";

interface ZasilkovnaWidgetProps {
	apiKey: string;
	onPointSelected: (point: PacketaPoint) => void;
	selectedPoint: PacketaPoint | null;
}

/**
 * Zásilkovna (Packeta) pickup point selector widget.
 * Loads the Packeta widget script dynamically and provides a UI
 * for selecting and displaying a pickup point.
 */
export const ZasilkovnaWidget: FC<ZasilkovnaWidgetProps> = ({ apiKey, onPointSelected, selectedPoint }) => {
	const t = useTranslations("checkout");
	const scriptLoadedRef = useRef(false);

	// Load the Packeta widget script once
	useEffect(() => {
		if (scriptLoadedRef.current) return;
		if (typeof document === "undefined") return;

		// Check if already loaded
		const existing = document.querySelector('script[src*="widget.packeta.com"]');
		if (existing) {
			scriptLoadedRef.current = true;
			return;
		}

		const script = document.createElement("script");
		script.src = "https://widget.packeta.com/v6/www/js/library.js";
		script.async = true;
		script.onload = () => {
			scriptLoadedRef.current = true;
		};
		document.head.appendChild(script);

		return () => {
			// Don't remove the script on unmount — it should persist
		};
	}, []);

	const handlePickPoint = () => {
		if (!window.Packeta) {
			console.error("Packeta widget not loaded");
			return;
		}

		window.Packeta.Widget.pick(
			apiKey,
			(point) => {
				if (point) {
					onPointSelected(point);
				}
			},
			{ country: "cz", language: "cs" },
		);
	};

	return (
		<div className="mt-3 space-y-3">
			{selectedPoint && (
				<div className="rounded-lg border border-border bg-secondary/30 p-3">
					<p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{t("selectedPickupPoint")}
					</p>
					<div className="flex items-start gap-2">
						<MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
						<div className="text-sm">
							<p className="font-medium">{selectedPoint.name}</p>
							<p className="text-muted-foreground">{selectedPoint.nameStreet}</p>
							<p className="text-muted-foreground">
								{selectedPoint.city}, {selectedPoint.zip}
							</p>
						</div>
					</div>
				</div>
			)}

			<Button type="button" variant="outline-solid" onClick={handlePickPoint} className="w-full">
				<MapPin className="mr-2 h-4 w-4" />
				{selectedPoint ? t("changePickupPoint") : t("choosePickupPoint")}
			</Button>
		</div>
	);
};
