/**
 * useDeviceApproval — getDeviceRequest / approveDeviceRequest /
 * denyDeviceRequest bound to the provider's authUrl, publishable key, and
 * the signed-in user's app session token.
 *
 * @example
 * ```tsx
 * const { isReady, getDeviceRequest, approveDeviceRequest } = useDeviceApproval();
 * const code = new URLSearchParams(location.search).get("code") ?? "";
 * useEffect(() => {
 *   if (isReady && code) void getDeviceRequest(code).then(setFound);
 * }, [isReady, code]);
 * ```
 */

import { useCallback, useMemo } from "react";
import { useKovaAuth } from "../context";
import {
  approveDeviceRequest,
  denyDeviceRequest,
  getDeviceRequest,
  type DeviceApprovalError,
  type DeviceDecisionResult,
  type DeviceRequestResult,
} from "../device-approval";

export interface UseDeviceApprovalReturn {
  /** True once there is a signed-in app session to approve with. */
  isReady: boolean;
  getDeviceRequest: (userCode: string) => Promise<DeviceRequestResult>;
  approveDeviceRequest: (userCode: string) => Promise<DeviceDecisionResult>;
  denyDeviceRequest: (userCode: string) => Promise<DeviceDecisionResult>;
}

const NOT_SIGNED_IN: DeviceApprovalError = {
  ok: false,
  error: "invalid_session",
  status: 0,
  message: "Sign in to approve this device",
};

export function useDeviceApproval(): UseDeviceApprovalReturn {
  const { authUrl, publishableKey, sessionToken } = useKovaAuth();
  const isReady = Boolean(publishableKey && sessionToken);

  const run = useCallback(
    <T,>(fn: (o: { authUrl: string; publishableKey: string; sessionToken: string; userCode: string }) => Promise<T>) =>
      (userCode: string): Promise<T | DeviceApprovalError> =>
        publishableKey && sessionToken
          ? fn({ authUrl, publishableKey, sessionToken, userCode })
          : Promise.resolve(NOT_SIGNED_IN),
    [authUrl, publishableKey, sessionToken],
  );

  return useMemo(
    () => ({
      isReady,
      getDeviceRequest: run(getDeviceRequest) as (userCode: string) => Promise<DeviceRequestResult>,
      approveDeviceRequest: run(approveDeviceRequest) as (userCode: string) => Promise<DeviceDecisionResult>,
      denyDeviceRequest: run(denyDeviceRequest) as (userCode: string) => Promise<DeviceDecisionResult>,
    }),
    [isReady, run],
  );
}
