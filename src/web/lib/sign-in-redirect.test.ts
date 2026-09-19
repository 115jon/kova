import { describe, expect, it } from "vitest";
import {
  buildNativeHandoffPath,
  buildSignInReturnUrl,
} from "./sign-in-redirect";

describe("sign-in redirect helpers", () => {
  const nativeSearch = {
    pk: "pk_dev_float",
    redirect_url: "float://auth",
    native_handoff: "1",
  };

  it("routes native sign-in through Kova's validated SDK bounce", () => {
    expect(buildNativeHandoffPath(nativeSearch)).toBe(
      "/api/hosted/oauth-complete?mode=sdk&pk=pk_dev_float&redirect_uri=float%3A%2F%2Fauth",
    );
  });

  it("does not create a handoff without an app key and redirect", () => {
    expect(buildNativeHandoffPath({ ...nativeSearch, pk: undefined })).toBeNull();
    expect(
      buildNativeHandoffPath({ ...nativeSearch, redirect_url: undefined }),
    ).toBeNull();
  });

  it("recognizes native context after the router strips the optional hint", () => {
    expect(
      buildNativeHandoffPath({ ...nativeSearch, native_handoff: undefined }),
    ).toBe(
      "/api/hosted/oauth-complete?mode=sdk&pk=pk_dev_float&redirect_uri=float%3A%2F%2Fauth",
    );
  });

  it("preserves native context when an auth method returns to sign-in", () => {
    expect(buildSignInReturnUrl(nativeSearch, "https://auth.example")).toBe(
      "https://auth.example/sign-in?pk=pk_dev_float&redirect_url=float%3A%2F%2Fauth&native_handoff=1",
    );
  });

  it("uses the ordinary sign-in page when no native handoff is requested", () => {
    expect(buildSignInReturnUrl({}, "https://auth.example")).toBe(
      "https://auth.example/sign-in",
    );
  });
});
