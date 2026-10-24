import { expect, test } from "@playwright/test";
import { build } from "vite";

const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useDaymark} from '${process.cwd()}/src/client/useDaymark.ts';
function Harness(){const state=useDaymark();window.daymark=state;return React.createElement('pre',null,JSON.stringify({account:state.account?.id,store:state.store?.accountId,keys:state.operations.map(op=>op.key)}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const storage = `
export const openStore=async accountId=>({accountId,close(){},subscribe(){return ()=>{}},list(){return accountId==='B'?new Promise(resolve=>window.releaseB=()=>resolve([{key:'PRIVATE-B'}])):Promise.resolve([{key:'PRIVATE-A'}]);}});
`;
const api = `
let account={id:'A',name:'A',email:'a@example.com',role:'user'};
export async function api(path){if(path.includes('sign-in')) account={...account,id:'B'};return {account,registrationOpen:false};}
`;
test("withholds the previous account's history while a new account opens", async ({ browser }) => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "account-harness",
        enforce: "pre",
        resolveId(source, importer) {
          if (source === "virtual:harness") return "\0harness";
          if (
            importer?.endsWith("useDaymark.ts") &&
            ["./storage", "./api", "./sync"].includes(source)
          )
            return `\0mock${source}`;
        },
        load(id) {
          if (id === "\0harness") return entry;
          if (id === "\0mock./storage") return storage;
          if (id === "\0mock./api") return api;
          if (id === "\0mock./sync")
            return "export class SyncEngine {async run(){} async refreshPending(){} stop(){}}";
        },
      },
    ],
    build: {
      write: false,
      rolldownOptions: { input: "virtual:harness", output: { format: "iife", name: "Harness" } },
      minify: true,
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  const code =
    "output" in output ? output.output.find((chunk) => chunk.type === "chunk")?.code : undefined;
  expect(code).toBeTruthy();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/harness", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("http://localhost:5184/harness");
  await page.addScriptTag({ content: code });
  await expect(page.locator("pre")).toContainText("PRIVATE-A");
  await page.evaluate(() =>
    (
      window as unknown as {
        daymark: { signIn: (email: string, password: string) => Promise<void> };
      }
    ).daymark.signIn("b@example.com", "unused"),
  );
  await page.waitForFunction(
    () => typeof (window as unknown as { releaseB?: () => void }).releaseB === "function",
  );
  await expect(page.locator("pre")).not.toContainText("PRIVATE-A");
  await page.evaluate(() => (window as unknown as { releaseB: () => void }).releaseB());
  await expect(page.locator("pre")).toContainText("PRIVATE-B");
  await context.close();
});
