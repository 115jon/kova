# Changelog

## [1.2.0](https://github.com/115jon/kova/compare/kova-react-v1.1.0...kova-react-v1.2.0) (2026-10-22)


### Features

* **sdk:** ✨ add releaseDeviceRequest for switching accounts ([59c4a0f](https://github.com/115jon/kova/commit/59c4a0f1cdf12292fc353c87a7fa67ba95755500))

## [1.1.0](https://github.com/115jon/kova/compare/kova-react-v1.0.0...kova-react-v1.1.0) (2026-10-22)


### Features

* **sdk:** ✨ approve device sign-ins from the app's own site ([7c80296](https://github.com/115jon/kova/commit/7c8029677c899ffe5412a2efc67c1f435dde32a3))

## [1.0.0](https://github.com/115jon/kova/compare/kova-react-v0.1.1...kova-react-v1.0.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* **sdk:** Requires a Kova Auth server on better-auth 1.7. The SDK now depends on better-auth ~1.7.12. PluginConfig.genericOAuth no longer adds a client plugin; custom OIDC providers sign in with signIn.social({ provider }).

### Features

* **auth:** ✨ ask which account to continue as instead of redirecting ([085bcb3](https://github.com/115jon/kova/commit/085bcb321d8f9482a12206c7ba1c3aa9143e68e9))
* **auth:** ✨ snapshot the live october kova deploy ([a96e9af](https://github.com/115jon/kova/commit/a96e9af548f26fd47ac5062eee927e6bc72913b0))
* **sdk:** ✨ add startDeviceSignIn for code-based sign-in ([fc159ec](https://github.com/115jon/kova/commit/fc159ec28b323a2654b3035a420c395ddca556d9))
* **sdk:** ✨ let hosts hand app branding to the sign-in card ([7ceb90b](https://github.com/115jon/kova/commit/7ceb90b644e5f35120cc0a33c86b8c019e313a11))
* **sdk:** ✨ only accept sign-ins this browser started ([33f2b03](https://github.com/115jon/kova/commit/33f2b0398d927ff7103996678c30c23d74430782))
* **sdk:** ✨ restyle the sign-in card in the clear ink look ([568cdcf](https://github.com/115jon/kova/commit/568cdcf05162a20a8fc6e86c04a9ae1b9e17e002))


### Bug Fixes

* **auth:** 🐛 keep app session tokens inside their app ([873bd60](https://github.com/115jon/kova/commit/873bd6042fb2f66cebf4c8a9e075a6e933523757))
* **sdk:** 🐛 accept the opaque publishable keys kova issues ([ee68fcf](https://github.com/115jon/kova/commit/ee68fcf95558f899f4c0359ddf9e4ce410f32a08))
* **sdk:** 🐛 show sign-in errors and finish sign-up from the email ([61310d1](https://github.com/115jon/kova/commit/61310d1693027154babd2c162f40c5c2cfb29afb))
* **security:** 🔒 pin better-auth 1.6.33 and harden hosted auth ([8ba02bd](https://github.com/115jon/kova/commit/8ba02bde070895e52c3d5d1e7f9521cb52093f14))
