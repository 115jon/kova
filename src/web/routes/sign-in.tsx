import { AuthPage } from "@/components/AuthPage";
import { validateSignInSearch } from "@/lib/sign-in-redirect";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in")({
  validateSearch: validateSignInSearch,
  component: SignInPage,
});

function SignInPage() {
  return <AuthPage mode="sign-in" search={Route.useSearch()} />;
}
