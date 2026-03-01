import { NextRequest, NextResponse } from "next/server";
import { getSessionSocialIdFromRequest } from "@/lib/server/sessionAuth";

/**
 * Validates that request carries a valid authenticated session for the target socialId.
 *
 * @param req - Next request containing session cookie
 * @param socialId - The target user MongoDB ObjectId as string
 * @returns true if validation succeeds
 */
export async function validateUserAuthentication(
  req: NextRequest,
  socialId: string
): Promise<boolean> {
  if (!socialId) return false;
  const authenticatedSocialId = await getSessionSocialIdFromRequest(req);
  return authenticatedSocialId === socialId;
}

/**
 * Validates user authentication and returns an error response if validation fails.
 * To be used at the beginning of POST/PUT handlers that modify user data.
 *
 * @param req - Next request containing session cookie
 * @param socialId - The user's MongoDB ObjectId as string
 * @returns NextResponse with error or null if validation succeeds
 */
export async function validateUserAuthenticationOrRespond(
  req: NextRequest,
  socialId: string
): Promise<NextResponse | null> {
  const isValid = await validateUserAuthentication(req, socialId);

  if (!isValid) {
    return NextResponse.json(
      { success: false, error: "Unauthorized: Invalid or missing authentication" },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Validates that the socialId being written matches the authenticated user.
 * Prevents impersonation attacks.
 *
 * @param authenticatedSocialId - The user making the request
 * @param targetSocialId - The user being written as
 * @returns NextResponse with error or null if validation succeeds
 */
export async function validateUserOwnership(
  authenticatedSocialId: string,
  targetSocialId: string
): Promise<NextResponse | null> {
  if (authenticatedSocialId !== targetSocialId) {
    return NextResponse.json(
      { success: false, error: "Forbidden: Cannot write data as a different user" },
      { status: 403 }
    );
  }

  return null;
}
