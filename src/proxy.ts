export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/cron|signin|_next/static|_next/image|favicon.ico|image|images|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
