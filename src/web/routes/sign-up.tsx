import { AuthPage } from "@/components/AuthPage";
import { validateSignInSearch } from "@/lib/sign-in-redirect";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-up")({
  validateSearch: validateSignInSearch,
  component: SignUpPage,
});

function SignUpPage() {
  return <AuthPage mode="sign-up" search={Route.useSearch()} />;
}
