import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth }) }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-test-key");
});
describe("password authentication", () => {
  it("signs in with a password without an email OTP request", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const { signInPassword } = await import("./supabase");
    await signInPassword(" person@example.com ", " pass phrase ");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: " pass phrase ",
    });
  });
  it("propagates invalid credentials", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: new Error("Invalid login credentials"),
    });
    const { signInPassword } = await import("./supabase");
    await expect(signInPassword("person@example.com", "bad")).rejects.toThrow(
      "Invalid login",
    );
  });
  it("distinguishes confirmation-required signup from an active session", async () => {
    const { createPasswordAccount } = await import("./supabase");
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect(await createPasswordAccount("person@example.com", "password")).toBe(
      false,
    );
    auth.signUp.mockResolvedValue({ data: { session: {} }, error: null });
    expect(await createPasswordAccount("person@example.com", "password")).toBe(
      true,
    );
  });
  it("uses the recovery callback and preserves password whitespace", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    const { requestPasswordReset, updatePassword } = await import("./supabase");
    await requestPasswordReset("person@example.com");
    expect(auth.resetPasswordForEmail.mock.calls[0][1].redirectTo).toContain(
      "?passwordRecovery=1",
    );
    await updatePassword(" long password ");
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: " long password ",
    });
  });
});
