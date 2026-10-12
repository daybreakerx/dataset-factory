import type { Page } from "@playwright/test";

/**
 * 打标页布局用的打桩数据（长名称版）：一份目录、一条策略、一枚已完成条目，
 * 顶栏请求链三枚胶囊（端点章＋提示词＋Skill）。
 *
 * 布局断言只关心宽度与位置，数据取得越「满」越能压出让位秩序，故标题与名称都取长版。
 * 两份套件（尺寸对齐／窄屏三段）共用这一份，避免同一组桩数据写两处各自漂移。
 */
export async function mockLongNameFixtures(page: Page): Promise<void> {
  await page.route("**/api/workdirs", (route) =>
    route.fulfill({
      json: [
        {
          id: "layout",
          title: "用于布局验证的长工作目录名称",
          path: "/layout",
          last_used_at: 0,
        },
      ],
    }),
  );
  await page.route("**/api/workdirs/layout/batches", (route) =>
    route.fulfill({
      json: [
        {
          id: "s1",
          seq: 1,
          name: "用于布局验证的长策略名称",
          active: true,
          created_at: "",
          description: "",
          product_count: 1,
        },
      ],
    }),
  );
  await page.route("**/api/workdirs/layout/batches/s1/items", (route) =>
    route.fulfill({
      json: {
        batch: 1,
        query: "",
        groups: {
          done: [
            {
              item: "sample",
              name: "sample.jpg",
              status: "done",
              media: "image",
              can_retry: true,
              in_retry: false,
            },
          ],
        },
      },
    }),
  );
  // L3：空闲 = 200 + null（运行状态组因此落在「本批运行史」分支，本桩下出「开始打标」）。
  await page.route("**/runs/current", (route) =>
    route.fulfill({ status: 200, json: null }),
  );
  await page.route("**/runs/latest", (route) =>
    route.fulfill({ json: { record: null, log_path: null, items_path: null } }),
  );
  await page.route("**/batches/s1/snapshot", (route) =>
    route.fulfill({
      json: {
        built_at: "2026-09-18T00:00:00Z",
        changed: false,
        endpoint: {
          name: "Example",
          model: "caption-model",
          api_format: "openai-chat",
          base_url: "https://example.test/v1",
          request_params: {},
          sha256: "endpoint",
        },
        prompt: { name: "Detailed caption", body: "Describe the image.", sha256: "prompt" },
        skills: [
          { name: "caption-style", body: "Use plain language.", sha256: "skill" },
        ],
        recorded_sha256: "snapshot",
        sha256: "snapshot",
        tool_version: "0.1.0",
      },
    }),
  );
  await page.route("**/export/plan?*", (route) =>
    route.fulfill({
      json: {
        batch: 1,
        included: [
          {
            item: "sample",
            name: "sample.jpg",
            asset_name: "001.jpg",
            caption_name: "001.txt",
            asset_bytes: 68,
            caption_bytes: 17,
            integrity: "valid",
          },
        ],
        excluded: [],
        total_bytes: 85,
        sequential: true,
        non_ascii_names: false,
      },
    }),
  );
}
