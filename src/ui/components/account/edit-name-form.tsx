"use client";

import { useState, useTransition, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { updateProfile } from "@/app/[channel]/(main)/account/actions";

type Props = {
	firstName: string;
	lastName: string;
};

export function EditNameForm({ firstName, lastName }: Props) {
	const [isEditing, setIsEditing] = useState(false);
	const [isPending, startTransition] = useTransition();
	const t = useTranslations("account");
	const ta = useTranslations("auth");
	const tc = useTranslations("common");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState(false);

	const handleSubmit = useCallback(
		(formData: FormData) => {
			setError("");
			setSuccess(false);

			startTransition(async () => {
				const result = await updateProfile(formData);
				if (!result.success) {
					setError(result.error);
				} else {
					setSuccess(true);
					setIsEditing(false);
				}
			});
		},
		[startTransition],
	);

	if (!isEditing) {
		return (
			<div className="flex items-center justify-between">
				<div>
					<p className="text-sm text-muted-foreground">{tc("name")}</p>
					<p className="font-medium">
						{firstName || lastName ? `${firstName} ${lastName}`.trim() : tc("notSet")}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{success && (
						<span aria-live="polite" className="text-sm text-green-600">
							{t("nameUpdated")}
						</span>
					)}
					<Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
						{tc("edit")}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<form action={handleSubmit} className="space-y-4">
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="firstName">{ta("firstName")}</Label>
					<Input
						id="firstName"
						name="firstName"
						autoComplete="given-name"
						defaultValue={firstName}
						required
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="lastName">{ta("lastName")}</Label>
					<Input id="lastName" name="lastName" autoComplete="family-name" defaultValue={lastName} required />
				</div>
			</div>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={isPending}>
					{isPending ? tc("saving") : tc("save")}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => {
						setIsEditing(false);
						setError("");
					}}
				>
					{tc("cancel")}
				</Button>
			</div>
		</form>
	);
}
