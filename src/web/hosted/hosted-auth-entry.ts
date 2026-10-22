import { bootHostedArt } from "./hosted-art";
import { bootHostedAuth } from "./hosted-auth";

// Sign-in/sign-up: renders the form into #root. The device page has no
// bootstrap and no #root, so only the art mounts there.
bootHostedAuth();
bootHostedArt();
