import { expect, test } from "@playwright/test";

test.skip(process.env.RUN_E2E !== "true", "Set RUN_E2E=true to execute smoke flow");

test("signup -> create account -> create chat -> send message", async ({ page }) => {
  const email = process.env.E2E_EMAIL ?? `demo-${Date.now()}@example.com`;
  const password = process.env.E2E_PASSWORD ?? "password123";
  const accountName = `Acme ${Date.now()}`;
  const chatName = `sales-${Date.now()}`;
  const text = "hello";

  await page.goto("/auth");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByPlaceholder("Acme Inc").fill(accountName);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Create chat").fill(chatName);
  await page.getByRole("button", { name: "New chat" }).click();
  await page.getByRole("link", { name: chatName }).click();

  await page.getByPlaceholder("Type message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(`Right, ${text}`)).toBeVisible();
});
