import { Mail, Calendar } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EditNameForm } from "@/ui/components/account/edit-name-form";
import { ChangePasswordForm } from "@/ui/components/account/change-password-form";
import { DeleteAccountSection } from "@/ui/components/account/delete-account-section";
import { getCurrentUser } from "../get-current-user";
import { formatDate } from "@/config/locale";

export default async function AccountSettingsPage() {
	const [user, t, tc] = await Promise.all([
		getCurrentUser(),
		getTranslations("account"),
		getTranslations("common"),
	]);
	if (!user) return null;

	const memberSince = formatDate(new Date(user.dateJoined), { month: "long", year: "numeric" });

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">{t("manageSettings").split(".")[0]}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{t("manageSettings")}</p>
			</div>

			<div className="divide-y rounded-lg border">
				<div className="p-4 sm:p-6">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm text-muted-foreground">{tc("email")}</p>
							<div className="flex items-center gap-2">
								<Mail className="h-4 w-4 text-muted-foreground" />
								<p className="font-medium">{user.email}</p>
							</div>
						</div>
					</div>
				</div>

				<div className="p-4 sm:p-6">
					<EditNameForm firstName={user.firstName} lastName={user.lastName} />
				</div>

				<div className="p-4 sm:p-6">
					<ChangePasswordForm />
				</div>

				<div className="p-4 sm:p-6">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Calendar className="h-4 w-4" />
						<span>{t("memberSince", { date: memberSince })}</span>
					</div>
				</div>
			</div>

			<div className="border-destructive/20 rounded-lg border p-4 sm:p-6">
				<DeleteAccountSection />
			</div>
		</div>
	);
}
