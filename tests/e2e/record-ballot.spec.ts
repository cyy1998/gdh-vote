import { expect, test, type Page } from "@playwright/test";

async function submitValidUnionBallot(
  page: Page,
  groupNumber: "1" | "2" | "3",
  writeIn?: string,
) {
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
  await expect(notice).toContainText(
    new RegExp(`第 ${groupNumber}-\\d+ 号选票录入成功`),
  );
  const match = (await notice.textContent())?.match(/第\s*(\d+-\d+)\s*号/);
  expect(match).toBeTruthy();
  await expect(notice).toBeHidden({ timeout: 2_500 });
  return match![1];
}

test("recording group submits a valid union ballot and sees its ballot number", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /第二届“两委”委员选举/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /工会第一组/ }).click();
  const groupProgress = page.getByTestId("group-recording-count");
  const electionProgress = page.getByTestId("election-recording-count");
  await expect(groupProgress).not.toHaveText("—");
  const initialGroupProgress = Number(await groupProgress.textContent());
  const initialElectionProgress = Number(await electionProgress.textContent());
  await expect(page.getByTestId("elector-limit")).not.toHaveText("—");
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
  await expect(page.getByRole("status")).toContainText(
    /第 1-\d+ 号选票录入成功/,
  );
  await expect(groupProgress).toHaveText(String(initialGroupProgress + 1));
  await expect(electionProgress).toHaveText(
    String(initialElectionProgress + 1),
  );
});

test("space submits a valid ballot through the regular submission path", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();

  const rows = page.locator(".candidate-row");
  for (let index = 0; index < 3; index += 1)
    await rows.nth(index).getByRole("button", { name: "反对" }).click();

  await page.keyboard.press("Space");

  await expect(page.getByRole("status")).toContainText(
    /第 1-\d+ 号选票录入成功/,
  );
});

test("space still asks for confirmation before submitting an invalid ballot", async ({
  page,
}) => {
  let submissionCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/ballots"))
      submissionCount += 1;
  });

  await page.goto("./");
  await page.getByRole("button", { name: /经审组/ }).click();
  await expect(page.getByText("当前为超额无效票")).toBeVisible();

  await page.keyboard.press("Space");

  await expect(
    page.getByRole("dialog", { name: "确认提交超额无效票？" }),
  ).toBeVisible();
  expect(submissionCount).toBe(0);
});

test("another recording group updates only the election-wide progress", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();
  const groupProgress = page.getByTestId("group-recording-count");
  const electionProgress = page.getByTestId("election-recording-count");
  await expect(groupProgress).not.toHaveText("—");
  const initialGroupProgress = Number(await groupProgress.textContent());
  const initialElectionProgress = Number(await electionProgress.textContent());

  const otherGroup = await page.context().newPage();
  await otherGroup.goto("./");
  await otherGroup.getByRole("button", { name: /工会第二组/ }).click();
  await submitValidUnionBallot(otherGroup, "2");

  await expect(electionProgress).toHaveText(
    String(initialElectionProgress + 1),
    { timeout: 5_000 },
  );
  await expect(groupProgress).toHaveText(String(initialGroupProgress));
  await otherGroup.close();
});

test("a limit race keeps the draft and never submits it automatically", async ({
  page,
}) => {
  let full = false;
  let version = 1;
  let submissionCount = 0;
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        versions: { union: version, expense: 1 },
        generations: { union: 1, expense: 1 },
        electorLimits: { union: 180, expense: 180 },
      },
    }),
  );
  await page.route("**/api/recording-progress/union-1", (route) =>
    route.fulfill({
      json: {
        groupId: "union-1",
        electionId: "union",
        version,
        groupActiveBallots: 60,
        electionActiveBallots: full ? 180 : 179,
        electorLimit: 180,
      },
    }),
  );
  await page.route("**/api/ballots", (route) => {
    submissionCount += 1;
    full = true;
    return route.fulfill({
      status: 409,
      json: {
        error: "已达到 180 张未撤销选票上限",
        code: "ELECTOR_LIMIT",
      },
    });
  });

  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();
  const rows = page.locator(".candidate-row");
  for (let index = 0; index < 3; index += 1)
    await rows.nth(index).getByRole("button", { name: "反对" }).click();

  await page.getByRole("button", { name: "提交本票" }).click();
  const visibleProgress = page.getByRole("region", { name: "录入进度" });
  await expect(visibleProgress.getByText("已达到投票人数上限")).toBeVisible();
  await expect(page.getByRole("button", { name: "提交本票" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "记为无效票" })).toBeDisabled();
  await expect(rows.first().getByRole("button", { name: "反对" })).toHaveClass(
    /selected/,
  );

  full = false;
  version += 1;
  await expect(page.getByRole("button", { name: "提交本票" })).toBeEnabled({
    timeout: 5_000,
  });
  await expect(rows.first().getByRole("button", { name: "反对" })).toHaveClass(
    /selected/,
  );
  await page.waitForTimeout(500);
  expect(submissionCount).toBe(1);
});

test("mobile layout places recording progress before the candidate list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("./");
  await page.getByRole("button", { name: /经审组/ }).click();

  const progressBox = await page
    .getByRole("region", { name: "录入进度" })
    .boundingBox();
  const candidateBox = await page.locator(".candidate-panel").boundingBox();
  expect(progressBox).not.toBeNull();
  expect(candidateBox).not.toBeNull();
  expect(progressBox!.y).toBeLessThan(candidateBox!.y);
});

test("a progress outage reports the failure without blocking submission", async ({
  page,
}) => {
  await page.route("**/api/recording-progress/union-1", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "录入进度暂时不可用" },
    }),
  );

  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();

  await expect(
    page
      .getByRole("region", { name: "录入进度" })
      .getByText("进度更新失败，可继续录入"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "提交本票" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "记为无效票" })).toBeEnabled();
});

test("entrance title and live results use the updated labels", async ({
  page,
}) => {
  await page.goto("./");

  await expect(page.getByText("上海燃气有限公司工会委员会")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "第二届“两委”委员选举 计票系统" }),
  ).toBeVisible();
  await expect(page.locator(".seal")).toHaveCount(0);

  await page.getByRole("button", { name: "直接查看实时结果 →" }).click();
  const tableHead = page.locator(".result-row.table-head");
  await expect(tableHead).toContainText("赞成票");
  await expect(tableHead).toContainText("反对票");
  await expect(tableHead).toContainText("弃权票");
});

test("client reports connectivity through polling without opening an event stream", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });

  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();
  await expect(page.getByText("服务器已连接")).toBeVisible({ timeout: 5_000 });

  expect(apiRequests.some((url) => url.endsWith("/api/config"))).toBe(true);
  expect(apiRequests.some((url) => url.endsWith("/api/events"))).toBe(false);
});

test("manual invalid ballot uses one custom confirmation and a visible result", async ({
  page,
}) => {
  await page.goto("./");
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
  await page.goto("./");
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
  await page.goto("./");
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

test("the union default ballot abstains three specified candidates and approves the rest", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();

  const rows = page.locator(".candidate-row");
  await rows.first().getByRole("button", { name: "反对" }).click();
  await page.getByRole("button", { name: "添加另选人" }).click();
  await page.getByPlaceholder("输入姓名").fill("测试另选人");

  const ballotActions = page.locator(".ballot-summary > button");
  await expect(ballotActions.nth(0)).toHaveText("默认选票");
  await expect(ballotActions.nth(1)).toHaveText("提交本票");
  await ballotActions.nth(0).click();

  for (const name of ["金一冰", "黄立群", "徐晓慧"]) {
    await expect(
      rows.filter({ hasText: name }).getByRole("button", { name: "弃权" }),
    ).toHaveClass(/selected/);
  }
  await expect(
    rows.filter({ has: page.locator("button.selected", { hasText: "赞成" }) }),
  ).toHaveCount(23);
  await expect(page.getByPlaceholder("输入姓名")).toHaveCount(0);
  await expect(page.getByText("当前为有效票")).toBeVisible();
  await expect(page.getByText("赞成合计 23 人")).toBeVisible();
});

test("the expense default ballot abstains Li Chunjun and approves the rest", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /经审组/ }).click();

  const rows = page.locator(".candidate-row");
  await rows.nth(1).getByRole("button", { name: "反对" }).click();
  await page.getByRole("button", { name: "添加另选人" }).click();
  await page.getByPlaceholder("输入姓名").fill("测试另选人");

  const ballotActions = page.locator(".ballot-summary > button");
  await expect(ballotActions.nth(0)).toHaveText("默认选票");
  await expect(ballotActions.nth(1)).toHaveText("提交本票");
  await ballotActions.nth(0).click();

  await expect(
    rows.filter({ hasText: "李春君" }).getByRole("button", { name: "弃权" }),
  ).toHaveClass(/selected/);
  await expect(
    rows.filter({ has: page.locator("button.selected", { hasText: "赞成" }) }),
  ).toHaveCount(7);
  await expect(page.getByPlaceholder("输入姓名")).toHaveCount(0);
  await expect(page.getByText("当前为有效票")).toBeVisible();
  await expect(page.getByText("赞成合计 7 人")).toBeVisible();
});

test("administrator sees prominent password failure and reset success feedback", async ({
  page,
}) => {
  await page.goto("./");
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

test("administrator can configure elector limits", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();
  await page.getByRole("button", { name: "管理" }).click();

  await page.getByLabel("管理员口令").fill("test-admin-password");
  await page.getByLabel("工会委员会选举").fill("175");
  await page.getByLabel("经费审查委员会选举").fill("168");
  await page.getByRole("button", { name: "保存投票人数上限" }).click();

  await expect(page.getByRole("status")).toContainText("投票人数上限保存成功");
  await expect(page.getByLabel("工会委员会选举")).toHaveValue("175");
  await expect(page.getByLabel("经费审查委员会选举")).toHaveValue("168");
});

test("history can sort by submission time and shows a paper-like ballot grid", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /工会第三组/ }).click();

  const earlierBallotNumber = await submitValidUnionBallot(page, "3");
  const laterBallotNumber = await submitValidUnionBallot(page, "3", "张三");
  await page.getByRole("button", { name: "录入历史" }).click();

  const historyRows = page.getByRole("row").filter({ hasText: /第 3-\d+ 号/ });
  await expect(historyRows.first()).toContainText(`第 ${laterBallotNumber} 号`);
  await expect(historyRows.nth(1)).toContainText(
    `第 ${earlierBallotNumber} 号`,
  );

  const sort = page.getByRole("combobox", { name: "提交时间排序" });
  await sort.selectOption("asc");
  const rowCount = await historyRows.count();
  await expect(historyRows.nth(rowCount - 2)).toContainText(
    `第 ${earlierBallotNumber} 号`,
  );
  await expect(historyRows.last()).toContainText(`第 ${laterBallotNumber} 号`);

  await sort.selectOption("desc");
  await historyRows.first().getByRole("button", { name: "查看票面" }).click();

  const ballot = page.getByRole("region", {
    name: `第 ${laterBallotNumber} 号选票票面`,
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

test("history ignores an older response that arrives after a refresh", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /工会第一组/ }).click();

  let releaseFirstResponse!: () => void;
  const firstResponseCanFinish = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  let markFirstResponseCaptured!: () => void;
  const firstResponseCaptured = new Promise<void>((resolve) => {
    markFirstResponseCaptured = resolve;
  });
  let markFirstResponseFulfilled!: () => void;
  const firstResponseFulfilled = new Promise<void>((resolve) => {
    markFirstResponseFulfilled = resolve;
  });
  let historyRequestCount = 0;

  await page.route("**/api/history/union-1", async (route) => {
    historyRequestCount += 1;
    if (historyRequestCount === 1) {
      const oldResponse = await route.fetch();
      markFirstResponseCaptured();
      await firstResponseCanFinish;
      await route.fulfill({ response: oldResponse });
      markFirstResponseFulfilled();
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "录入历史" }).click();
  await firstResponseCaptured;

  const recorder = await page.context().newPage();
  await recorder.goto("./");
  await recorder.getByRole("button", { name: /工会第一组/ }).click();
  const newBallotNumber = await submitValidUnionBallot(recorder, "1");

  const newRow = page
    .getByRole("row")
    .filter({ hasText: `第 ${newBallotNumber} 号` });
  await expect(newRow).toBeVisible({ timeout: 5_000 });

  releaseFirstResponse();
  await firstResponseFulfilled;
  await page.waitForTimeout(100);
  await expect(newRow).toBeVisible();
  expect(historyRequestCount).toBeGreaterThanOrEqual(2);
  await recorder.close();
});

test("withdrawing a ballot preserves its recorded choices in history", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /工会第二组/ }).click();

  const ballotNumber = await submitValidUnionBallot(page, "2");
  await page.getByRole("button", { name: "录入历史" }).click();
  const recordRow = page.getByRole("row").nth(1);
  await expect(recordRow).toContainText(`第 ${ballotNumber} 号`);

  let nativeDialogCount = 0;
  page.on("dialog", (dialog) => {
    nativeDialogCount += 1;
    void dialog.dismiss();
  });
  await recordRow.getByRole("button", { name: "撤销" }).click();
  const confirmation = page.getByRole("dialog", {
    name: `确认撤销第 ${ballotNumber} 号记录？`,
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("原记录将保留在录入历史中");
  expect(nativeDialogCount).toBe(0);
  await confirmation.getByRole("button", { name: "确认撤销" }).click();

  await expect(recordRow).toContainText("已撤销");
  await expect(recordRow.getByRole("cell").first()).toHaveText("-");
  await expect(recordRow).not.toContainText(`第 ${ballotNumber} 号`);
  await recordRow.getByRole("button", { name: "查看票面" }).click();

  const ballot = page.getByRole("region", {
    name: "已撤销选票票面",
  });
  await expect(ballot).not.toContainText(`第 ${ballotNumber} 号`);
  const listedCandidates = ballot.getByRole("list", {
    name: "正式候选人票面",
  });
  await expect(listedCandidates.getByLabel("王凯：反对")).toContainText("×");
  await expect(listedCandidates.getByLabel("元颖斌：反对")).toContainText("×");
  await expect(listedCandidates.getByLabel("邢辉：反对")).toContainText("×");
  await expect(listedCandidates.getByLabel("回申强：赞成")).toContainText("○");
});
