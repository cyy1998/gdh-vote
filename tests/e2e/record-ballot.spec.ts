import { expect, test, type Page } from "@playwright/test";

async function submitValidUnionBallot(page: Page, writeIn?: string) {
  const rows = page.locator(".candidate-row");
  const oppositionCount = writeIn ? 4 : 3;
  for (let index = 0; index < oppositionCount; index += 1) {
    await rows.nth(index).getByRole("button", { name: "反对" }).click();
  }
  if (writeIn) {
    await page.getByRole("button", { name: "添加另选人" }).click();
    await page.getByPlaceholder("输入姓名").fill(writeIn);
  }
  await page.getByRole("button", { name: "提交本票" }).click();
  const notice = page.getByRole("status");
  await expect(notice).toContainText(/第 \d+ 号选票录入成功/);
  const match = (await notice.textContent())?.match(/第\s*(\d+)\s*号/);
  expect(match).toBeTruthy();
  await expect(notice).toBeHidden({ timeout: 2_500 });
  return Number(match![1]);
}

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

test("an empty write-in input still consumes its available slot", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /工会第一组/ }).click();
  await page
    .locator(".candidate-row")
    .first()
    .getByRole("button", { name: "反对" })
    .click();

  const addWriteIn = page.getByRole("button", { name: "添加另选人" });
  await expect(addWriteIn).toBeEnabled();
  await addWriteIn.click();
  await expect(page.getByPlaceholder("输入姓名")).toHaveCount(1);
  await expect(addWriteIn).toBeDisabled();
});

test("resetting a ballot restores every candidate to approval", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /工会第一组/ }).click();

  const rows = page.locator(".candidate-row");
  await rows.first().getByRole("button", { name: "反对" }).click();
  await rows.nth(1).getByRole("button", { name: "弃权" }).click();
  await page.getByRole("button", { name: "添加另选人" }).click();
  await page.getByPlaceholder("输入姓名").fill("测试另选人");

  await page.getByRole("button", { name: "重置本票" }).click();

  await expect(
    rows.filter({ has: page.locator("button.selected", { hasText: "赞成" }) }),
  ).toHaveCount(26);
  await expect(page.getByPlaceholder("输入姓名")).toHaveCount(0);
});

test("administrator sees prominent password failure and reset success feedback", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /工会第一组/ }).click();
  await page.getByRole("button", { name: "管理" }).click();

  const password = page.getByLabel("管理员口令");
  await password.fill("wrong-password");
  await page.getByRole("button", { name: "清空工会委员会选举" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "确认清空工会委员会选举？",
  );
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByRole("status")).toContainText("管理员口令错误");

  await password.fill("test-admin-password");
  await page.getByRole("button", { name: "清空工会委员会选举" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByRole("status")).toContainText(
    "清空工会委员会选举成功",
  );
});

test("history can sort by submission time and shows a paper-like ballot grid", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /工会第三组/ }).click();

  const earlierSequence = await submitValidUnionBallot(page);
  const laterSequence = await submitValidUnionBallot(page, "张三");
  await page.getByRole("button", { name: "录入历史" }).click();

  const historyRows = page.getByRole("row").filter({ hasText: /第 \d+ 号/ });
  await expect(historyRows.first()).toContainText(`第 ${laterSequence} 号`);
  await expect(historyRows.nth(1)).toContainText(`第 ${earlierSequence} 号`);

  const sort = page.getByRole("combobox", { name: "提交时间排序" });
  await sort.selectOption("asc");
  const rowCount = await historyRows.count();
  await expect(historyRows.nth(rowCount - 2)).toContainText(
    `第 ${earlierSequence} 号`,
  );
  await expect(historyRows.last()).toContainText(`第 ${laterSequence} 号`);

  await sort.selectOption("desc");
  await historyRows.first().getByRole("button", { name: "查看票面" }).click();

  const ballot = page.getByRole("region", {
    name: `第 ${laterSequence} 号选票票面`,
  });
  const listedCandidates = ballot.getByRole("list", {
    name: "正式候选人票面",
  });
  await expect(listedCandidates.getByRole("listitem")).toHaveCount(26);
  await expect(listedCandidates.getByLabel("王凯：反对")).toContainText("×");
  await expect(listedCandidates.getByLabel("朱阳：赞成")).toContainText("○");
  await expect(
    ballot.getByRole("list", { name: "另选人票面" }).getByLabel("张三：赞成"),
  ).toContainText("○");
  const verticalLabelColumns = await ballot
    .locator(".write-in-sheet .ballot-sheet-labels > strong")
    .evaluate((label) => {
      const range = label.ownerDocument.createRange();
      range.selectNodeContents(label);
      return range.getClientRects().length;
    });
  expect(verticalLabelColumns).toBe(1);
});

test("withdrawing a ballot preserves its recorded choices in history", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /工会第二组/ }).click();

  const sequence = await submitValidUnionBallot(page);
  await page.getByRole("button", { name: "录入历史" }).click();
  const recordRow = page
    .getByRole("row")
    .filter({ hasText: `第 ${sequence} 号` });

  page.once("dialog", (dialog) => dialog.accept());
  await recordRow.getByRole("button", { name: "撤销" }).click();
  await expect(recordRow).toContainText("已撤销");
  await recordRow.getByRole("button", { name: "查看票面" }).click();

  const ballot = page.getByRole("region", {
    name: `第 ${sequence} 号选票票面`,
  });
  const listedCandidates = ballot.getByRole("list", {
    name: "正式候选人票面",
  });
  await expect(listedCandidates.getByLabel("王凯：反对")).toContainText("×");
  await expect(listedCandidates.getByLabel("元颖斌：反对")).toContainText("×");
  await expect(listedCandidates.getByLabel("邢辉：反对")).toContainText("×");
  await expect(listedCandidates.getByLabel("回申强：赞成")).toContainText("○");
});
