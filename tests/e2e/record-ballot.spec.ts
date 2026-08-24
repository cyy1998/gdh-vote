import { expect, test } from "@playwright/test";

test("recording group submits a valid union ballot and sees its sequence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /第二届“两委”委员选举/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /工会第一组/ }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(26);
  await expect(page.getByText("当前为超额无效票")).toBeVisible();
  for (const row of await page
    .locator(".candidate-row")
    .all()
    .then((rows) => rows.slice(0, 3))) {
    await row.getByRole("button", { name: "反对" }).click();
  }
  await expect(page.getByText("当前为有效票")).toBeVisible();
  await page.getByRole("button", { name: "提交本票" }).click();
  await expect(page.getByRole("status")).toContainText(/第 \d+ 号选票录入成功/);
});

test("manual invalid ballot uses one custom confirmation and a visible result", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /经审组/ }).click();
  await page.getByRole("button", { name: "记为无效票" }).click();

  const confirmation = page.getByRole("dialog", {
    name: "确认记为无效票？",
  });
  await expect(confirmation).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await confirmation.getByRole("button", { name: "确认记为无效票" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    /第 \d+ 号无效票录入成功/,
  );
});
