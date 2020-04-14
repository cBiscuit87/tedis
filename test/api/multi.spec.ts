import { Tedis, TedisPool } from "../../src/main";
import { config } from "../../tools/index";

const Pool = new TedisPool(config);
let Multi: Tedis;

beforeAll(async () => {
  Multi = await Pool.getTedis();
});

beforeEach(async () => {
  await Multi.command("SELECT", 6);
  await Multi.command("FLUSHDB");
});

afterAll(async () => {
  await Multi.command("FLUSHDB");
  Multi.close();
});

describe("Redis Mulit Test", () => {
  it(`should execute multiple commands`, async () => {
    expect(await Multi.command("MULTI")).toBe("OK");
    await Multi.set("foo", "1");
    await Multi.get("foo");
    expect(await Multi.command("EXEC")).toMatchObject(["OK", "1"]);
  });
});
