import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifySession } from "@/lib/auth";

// Gate everything except the login page and static assets.
export async function proxy(req: NextRequest) {
  if (await verifySession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
