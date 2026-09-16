import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ token?: string; email?: string; invite?: string }>;
}

export default async function VerifyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { token, email, invite } = params;

  if (!token || !email) {
    redirect("/auth/error?reason=missing_params");
  }

  // Redirect to API route which can set cookies
  let redirectUrl = `/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;
  if (invite) {
    redirectUrl += `&invite=${invite}`;
  }
  redirect(redirectUrl);
}
